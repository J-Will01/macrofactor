import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getFoodById, type LogTime, type MacroFactorClient } from '../../lib/api/index.js';
import { syncDayDashboard } from '../../lib/api/sync.js';
import { z } from 'zod';

function todayDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function parseLogTime(input: { date?: string; hour?: number; minute?: number }): LogTime {
  const now = new Date();
  return {
    date: input.date ?? todayDate(),
    hour: input.hour ?? now.getHours(),
    minute: input.minute ?? now.getMinutes(),
  };
}

type FoodServing = { description: string; gramWeight: number; amount: number };

function findServing(servings: FoodServing[], unit: string): FoodServing | undefined {
  if (['g', 'gram', 'grams'].includes(unit.toLowerCase())) {
    return (
      servings.find((s) => s.gramWeight === 1 && s.description.toLowerCase().includes('gram')) ||
      servings.find((s) => s.gramWeight === 1) ||
      servings.find((s) => s.description === '100 g')
    );
  }

  const aliases: Record<string, string[]> = {
    tbsp: ['tbsp', 'tablespoon'],
    tsp: ['tsp', 'teaspoon'],
    cup: ['cup'],
    oz: ['oz'],
    lb: ['lb'],
    ml: ['ml'],
    serving: ['serving'],
  };
  const targets = aliases[unit.toLowerCase()] || [unit.toLowerCase()];
  return servings.find((s) => targets.some((t) => s.description.toLowerCase().includes(t)));
}

function isGramServing(serving: FoodServing): boolean {
  const description = serving.description.toLowerCase();
  return (
    description === 'g' ||
    description === 'gram' ||
    description === 'grams' ||
    (serving.gramWeight === 1 && serving.amount === 1)
  );
}

export function registerFoodTools(server: McpServer, client: MacroFactorClient): void {
  server.tool(
    'get_food_log',
    `Retrieve a day's visible food log entries and return them as JSON. Use this when you need entry IDs or meal details before updates, copies, or deletes. Do not use this for macro totals over date ranges, because get_nutrition is a better fit for aggregate analysis. If you do not provide a date, the tool uses today's local date in YYYY-MM-DD format; see also update_food and copy_food_entries.`,
    {
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
    },
    { readOnlyHint: true },
    async ({ date }) => {
      const entries = await client.getFoodLog(date ?? todayDate());
      const active = entries.filter((entry) => !entry.deleted);
      return { content: [{ type: 'text' as const, text: JSON.stringify(active, null, 2) }] };
    }
  );

  server.tool(
    'search_foods',
    `Search the MacroFactor food database by text query and return matching foods, foodId values, and serving options. Use this before log_food when you need to choose a precise catalog food and serving. Do not use this for custom manual foods with direct macro numbers; use log_manual_food for that path. If results are ambiguous, refine the query or pass the chosen foodId from this result into log_food.`,
    { query: z.string().min(1) },
    { readOnlyHint: true },
    async ({ query }) => {
      const results = await client.searchFoods(query);
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    }
  );

  server.tool(
    'log_food',
    `Log a catalog food to the food diary using either a foodId from search_foods or a query fallback that selects the first search result. Prefer foodId for precision after search_foods, especially for branded foods or ambiguous names. Use grams for weight-based logging, amount plus unit for serving-name logging, or servingIndex plus quantity when you want an exact serving option from search_foods. Do not use this for custom macro-only foods; use log_manual_food instead. If no serving preference is provided, this tool defaults to 100 grams.`,
    {
      foodId: z.string().min(1).optional(),
      query: z.string().min(1).optional(),
      grams: z.number().positive().optional(),
      amount: z.number().positive().optional(),
      unit: z.string().min(1).optional(),
      servingIndex: z.number().int().min(0).optional(),
      quantity: z.number().positive().optional(),
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
      hour: z.number().int().min(0).max(23).optional(),
      minute: z.number().int().min(0).max(59).optional(),
    },
    { destructiveHint: false },
    async ({ foodId, query, grams, amount, unit, servingIndex, quantity: servingQuantity, date, hour, minute }) => {
      if (!foodId && !query) {
        throw new Error('log_food requires either "foodId" from search_foods or a non-empty "query"');
      }
      const food = foodId ? await getFoodById(foodId) : (await client.searchFoods(query ?? ''))[0];
      if (!food) {
        throw new Error(foodId ? `Food "${foodId}" not found` : `No food results found for query "${query ?? ''}"`);
      }

      let serving = findServing(food.servings, 'g') ?? food.servings[0];
      let quantity = grams ?? 100;
      let gramMode = true;

      if (servingIndex != null) {
        const indexedServing = food.servings[servingIndex];
        if (!indexedServing) {
          throw new Error(
            `servingIndex ${servingIndex} out of range for "${food.name}" (${food.servings.length} servings)`
          );
        }
        if (servingQuantity == null) {
          throw new Error('log_food with servingIndex requires positive "quantity"');
        }
        serving = indexedServing;
        quantity = servingQuantity;
        gramMode = isGramServing(serving);
      } else if (amount != null && unit) {
        const matched = findServing(food.servings, unit);
        if (!matched) {
          const available = food.servings.map((s) => s.description).join(', ');
          throw new Error(
            `No "${unit}" serving found for "${food.name}". Available servings: ${available}. Use grams instead or pick an available unit.`
          );
        }
        serving = matched;
        quantity = amount;
        gramMode = isGramServing(serving);
      } else if (grams != null) {
        serving = findServing(food.servings, 'g') ?? food.servings[0];
        quantity = grams;
        gramMode = true;
      }

      const logTime = parseLogTime({ date, hour, minute });
      await client.logSearchedFood(logTime, food, serving, quantity, gramMode);

      await syncDayDashboard(client, logTime.date);
      const result = {
        status: 'logged',
        food: food.name,
        foodId: food.foodId,
        serving: serving.description,
        quantity,
        date: logTime.date,
        hour: logTime.hour,
        minute: logTime.minute,
      };

      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    'log_manual_food',
    `Log a manual food entry by directly providing calories and macros, then return a JSON confirmation payload. Use this when the food is not in the searchable database or when you want exact custom macro values. Do not use this for searchable branded/common foods, because log_food can preserve richer serving metadata from the catalog. If you need to modify the logged quantity afterward, call update_food with the returned date and entry ID from get_food_log.`,
    {
      name: z.string().min(1),
      calories: z.number().min(0),
      protein: z.number().min(0),
      carbs: z.number().min(0),
      fat: z.number().min(0),
      imageId: z.string().optional(),
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
      hour: z.number().int().min(0).max(23).optional(),
      minute: z.number().int().min(0).max(59).optional(),
    },
    { destructiveHint: false },
    async ({ name, calories, protein, carbs, fat, imageId, date, hour, minute }) => {
      const logTime = parseLogTime({ date, hour, minute });
      if (imageId === undefined) {
        await client.logFood(logTime, name, calories, protein, carbs, fat);
      } else {
        await client.logFood(logTime, name, calories, protein, carbs, fat, imageId);
      }
      await syncDayDashboard(client, logTime.date);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              { status: 'logged', name, date: logTime.date, hour: logTime.hour, minute: logTime.minute },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  server.tool(
    'update_food',
    `Update the quantity for an existing food entry on a specific date and return an update confirmation JSON payload. Use this when you already know the target entry ID and need to correct quantity without creating duplicate entries. Do not use this to change to a different food item or to remove entries; use delete_food for removal workflows. Prerequisite: call get_food_log first if you need to discover entry IDs for that day.`,
    {
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      entryId: z.string().min(1),
      quantity: z.number().positive(),
    },
    { destructiveHint: false },
    async ({ date, entryId, quantity }) => {
      await client.updateFoodEntry(date, entryId, quantity);
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify({ status: 'updated', date, entryId, quantity }, null, 2) },
        ],
      };
    }
  );

  server.tool(
    'update_food_time',
    `Update the logged time (hour and minute) of an existing food entry without changing any other fields. Use this when an entry was scanned or logged at the wrong time of day — for example, scanning a lunch item in the morning. Do not use this to change the date; delete and re-log for a different date. Prerequisite: call get_food_log to get the entryId. Multiple entries (e.g., all items in a meal) can be updated by calling this tool once per entry.`,
    {
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      entryId: z.string().min(1),
      hour: z.number().int().min(0).max(23),
      minute: z.number().int().min(0).max(59),
    },
    { destructiveHint: false },
    async ({ date, entryId, hour, minute }) => {
      await client.updateFoodEntryTime(date, entryId, hour, minute);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ status: 'updated', date, entryId, hour, minute }, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    'delete_food',
    `Delete a food entry by removing it from the day's food log and return a deletion confirmation object. Use this for normal food log corrections after you have identified the exact entry ID. Do not rely on the underlying app's d flag as a soft-delete marker, because visible entries can also have d=true. Prerequisite: obtain a valid entryId via get_food_log before calling this tool.`,
    {
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      entryId: z.string().min(1),
    },
    { destructiveHint: true },
    async ({ date, entryId }) => {
      await client.deleteFoodEntry(date, entryId);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ status: 'deleted', date, entryId }, null, 2) }],
      };
    }
  );

  server.tool(
    'copy_food_entries',
    `Copy one or more visible food entries from a source date to a target date and return a summary of copied count. Use this for meal cloning workflows where you want to reuse prior entries without re-logging each food. Do not use this for a full day nutrition analysis or for deleting entries; use get_nutrition and delete_food respectively. Prerequisite: call get_food_log on the source date if you need entry IDs; when entryIds are omitted, all visible entries from the source date are copied.`,
    {
      fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      entryIds: z.array(z.string().min(1)).optional(),
    },
    { destructiveHint: false },
    async ({ fromDate, toDate, entryIds }) => {
      const sourceLog = await client.getFoodLog(fromDate);
      const activeEntries = sourceLog.filter((entry) => !entry.deleted);
      const selectedEntries = entryIds?.length
        ? activeEntries.filter((entry) => entryIds.includes(entry.entryId))
        : activeEntries;

      await client.copyEntries(toDate, selectedEntries);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                status: 'copied',
                fromDate,
                toDate,
                copied: selectedEntries.length,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );
}
