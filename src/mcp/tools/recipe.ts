import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { MacroFactorClient, RecipeIngredientInput } from '../../lib/api/index.js';
import { syncDayDashboard } from '../../lib/api/sync.js';
import { z } from 'zod';

function todayDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function parseLogTime(input: { date?: string; hour?: number; minute?: number }) {
  const now = new Date();
  return {
    date: input.date ?? todayDate(),
    hour: input.hour ?? now.getHours(),
    minute: input.minute ?? now.getMinutes(),
  };
}

export function registerRecipeTools(server: McpServer, client: MacroFactorClient): void {
  server.tool(
    'get_recipes',
    `List all saved custom recipes from MacroFactor and return them as JSON with per-serving macros. Use this to discover recipe IDs before calling log_recipe, or to review saved recipe contents. Do not use this for the food search database; use search_foods for catalog items. Related tools: log_recipe to log a recipe to the diary, get_food_log for already-logged entries.`,
    {},
    { readOnlyHint: true },
    async () => {
      const recipes = await client.getRecipes();
      return { content: [{ type: 'text' as const, text: JSON.stringify(recipes, null, 2) }] };
    }
  );

  server.tool(
    'get_recipe',
    `Retrieve a single saved recipe by ID and return its full details including ingredients and steps. Use this when you already have a recipe ID and need the full ingredient list or cooking instructions. Do not use this to list all recipes; use get_recipes for that. Prerequisite: obtain the recipe ID from get_recipes first.`,
    {
      recipeId: z.string().min(1),
    },
    { readOnlyHint: true },
    async ({ recipeId }) => {
      const recipe = await client.getRecipe(recipeId);
      if (!recipe) throw new Error(`Recipe ${recipeId} not found`);
      return { content: [{ type: 'text' as const, text: JSON.stringify(recipe, null, 2) }] };
    }
  );

  server.tool(
    'log_recipe',
    `Log one or more servings of a saved custom recipe to the food diary and return a confirmation payload. Use this when you want to log a recipe you previously saved in MacroFactor — it logs the aggregate macros for the requested number of servings. Do not use this for catalog foods (use log_food) or when you don't have a recipeId (use get_recipes first). Prerequisite: call get_recipes to find the recipeId. If no date is provided, today's date is used.`,
    {
      recipeId: z.string().min(1),
      servings: z.number().positive().default(1),
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
      hour: z.number().int().min(0).max(23).optional(),
      minute: z.number().int().min(0).max(59).optional(),
    },
    { destructiveHint: false },
    async ({ recipeId, servings, date, hour, minute }) => {
      const logTime = parseLogTime({ date, hour, minute });
      const entryId = await client.logRecipe(logTime, recipeId, servings);
      await syncDayDashboard(client, logTime.date);

      const recipe = await client.getRecipe(recipeId);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                status: 'logged',
                recipe: recipe?.name ?? recipeId,
                recipeId,
                entryId,
                servings,
                caloriesLogged: recipe ? Math.round(recipe.caloriesPerServing * servings) : null,
                proteinLogged: recipe ? Math.round(recipe.proteinPerServing * servings * 10) / 10 : null,
                date: logTime.date,
                hour: logTime.hour,
                minute: logTime.minute,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  const ingredientSchema = z.object({
    name: z.string().min(1),
    calories: z.number().min(0),
    protein: z.number().min(0),
    carbs: z.number().min(0),
    fat: z.number().min(0),
    quantity: z.number().positive().optional(),
    unit: z.string().optional(),
    brand: z.string().optional(),
    foodId: z.string().optional(),
    imageId: z.string().optional(),
  });

  server.tool(
    'create_recipe',
    `Create a new custom recipe in MacroFactor from a list of ingredients with pre-computed macros and return the saved recipe as JSON. Use this after calling search_foods for each ingredient to resolve macro values — pass the total calories/protein/carbs/fat for each ingredient as used in the full recipe (not per serving). The tool sums ingredient macros and divides by servings to compute per-serving targets. Do not use this to log the recipe to the diary; call log_recipe after creation. For URL-based recipes, fetch the page first, parse ingredients, search each one, then call this tool.`,
    {
      name: z.string().min(1),
      servings: z.number().positive(),
      ingredients: z.array(ingredientSchema).min(1),
      description: z.string().optional(),
      sourceUrl: z.string().optional(),
      steps: z.array(z.string()).optional(),
      prepTime: z.number().int().min(0).optional(),
      cookTime: z.number().int().min(0).optional(),
    },
    { destructiveHint: false },
    async ({ name, servings, ingredients, description, sourceUrl, steps, prepTime, cookTime }) => {
      const recipe = await client.createRecipe({
        name,
        servings,
        ingredients,
        description,
        sourceUrl,
        steps,
        prepTime,
        cookTime,
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(recipe, null, 2) }] };
    }
  );

  server.tool(
    'update_recipe',
    `Replace an existing recipe's ingredients, servings, and metadata with new values, then return the updated recipe as JSON. Use this to fix ingredient quantities, add or remove ingredients, rename the recipe, or change the serving count. All ingredients must be re-specified — this is a full replace, not a partial patch. Do not use this to log the recipe; use log_recipe for that. Prerequisite: obtain the recipeId from get_recipes, then prepare the full updated ingredient list (use search_foods to re-resolve any ingredients you need macro data for).`,
    {
      recipeId: z.string().min(1),
      name: z.string().min(1),
      servings: z.number().positive(),
      ingredients: z.array(ingredientSchema).min(1),
      description: z.string().optional(),
      sourceUrl: z.string().optional(),
      steps: z.array(z.string()).optional(),
      prepTime: z.number().int().min(0).optional(),
      cookTime: z.number().int().min(0).optional(),
    },
    { destructiveHint: false },
    async ({ recipeId, name, servings, ingredients, description, sourceUrl, steps, prepTime, cookTime }) => {
      const recipe = await client.updateRecipe(recipeId, {
        name,
        servings,
        ingredients,
        description,
        sourceUrl,
        steps,
        prepTime,
        cookTime,
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(recipe, null, 2) }] };
    }
  );

  const ingredientEditSchema = z.object({
    ingredientName: z.string().min(1).describe('Case-insensitive name match against existing ingredient'),
    action: z.enum(['scale', 'remove']),
    newQuantity: z
      .number()
      .positive()
      .optional()
      .describe('New quantity; macros are scaled proportionally from current values'),
    newUnit: z.string().optional(),
    calories: z.number().min(0).optional().describe('Override scaled calories instead of computing proportionally'),
    protein: z.number().min(0).optional(),
    carbs: z.number().min(0).optional(),
    fat: z.number().min(0).optional(),
  });

  server.tool(
    'edit_recipe',
    `Partially edit an existing recipe without re-specifying all ingredients. Supports scaling ingredient quantities (macros auto-scale proportionally), removing ingredients, and adding new ingredients. Also supports renaming the recipe or changing the serving count. Use this instead of update_recipe when you only want targeted changes. Prerequisite: call get_recipes to find the recipeId. To add a new ingredient you must provide its macro totals for the full batch (use search_foods to resolve them first).`,
    {
      recipeId: z.string().min(1),
      name: z.string().min(1).optional().describe('Rename the recipe'),
      servings: z.number().positive().optional().describe('Change number of servings'),
      description: z.string().optional(),
      sourceUrl: z.string().optional(),
      steps: z.array(z.string()).optional().describe('Replace all steps; omit to keep existing'),
      prepTime: z.number().int().min(0).optional(),
      cookTime: z.number().int().min(0).optional(),
      ingredientEdits: z
        .array(ingredientEditSchema)
        .optional()
        .describe('Scale or remove existing ingredients by name'),
      addIngredients: z
        .array(ingredientSchema)
        .optional()
        .describe('New ingredients to add (provide full batch macros)'),
    },
    { destructiveHint: false },
    async ({
      recipeId,
      name,
      servings,
      description,
      sourceUrl,
      steps,
      prepTime,
      cookTime,
      ingredientEdits,
      addIngredients,
    }) => {
      const existing = await client.getRecipe(recipeId);
      if (!existing) throw new Error(`Recipe ${recipeId} not found`);

      let ingredients: RecipeIngredientInput[] = existing.ingredients.map((ing) => ({
        name: ing.name,
        calories: ing.calories,
        protein: ing.protein,
        carbs: ing.carbs,
        fat: ing.fat,
        quantity: ing.quantity,
        unit: ing.unit,
        foodId: ing.foodId,
      }));

      for (const edit of ingredientEdits ?? []) {
        const lower = edit.ingredientName.toLowerCase();
        const idx = ingredients.findIndex((i) => i.name.toLowerCase().includes(lower));
        if (idx === -1)
          throw new Error(
            `Ingredient not found: "${edit.ingredientName}". Existing: ${ingredients.map((i) => i.name).join(', ')}`
          );

        if (edit.action === 'remove') {
          ingredients.splice(idx, 1);
        } else if (edit.action === 'scale') {
          const ing = ingredients[idx];
          const oldQty = ing.quantity ?? 1;
          const newQty = edit.newQuantity ?? oldQty;
          const ratio = newQty / oldQty;
          ingredients[idx] = {
            ...ing,
            quantity: newQty,
            unit: edit.newUnit ?? ing.unit,
            calories: edit.calories !== undefined ? edit.calories : Math.round(ing.calories * ratio * 10) / 10,
            protein: edit.protein !== undefined ? edit.protein : Math.round(ing.protein * ratio * 10) / 10,
            carbs: edit.carbs !== undefined ? edit.carbs : Math.round(ing.carbs * ratio * 10) / 10,
            fat: edit.fat !== undefined ? edit.fat : Math.round(ing.fat * ratio * 10) / 10,
          };
        }
      }

      for (const ing of addIngredients ?? []) {
        ingredients.push(ing);
      }

      const updated = await client.updateRecipe(recipeId, {
        name: name ?? existing.name,
        servings: servings ?? existing.servings,
        ingredients,
        description: description ?? existing.description,
        sourceUrl: sourceUrl ?? existing.sourceUrl,
        steps: steps ?? existing.steps,
        prepTime,
        cookTime,
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(updated, null, 2) }] };
    }
  );

  server.tool(
    'delete_recipe',
    `Permanently delete a saved custom recipe from MacroFactor and return a confirmation. Use this only when you want to remove the recipe from your saved library entirely. Does not affect any food log entries that previously used this recipe. Prerequisite: obtain the recipeId from get_recipes first.`,
    {
      recipeId: z.string().min(1),
    },
    { destructiveHint: true },
    async ({ recipeId }) => {
      await client.deleteRecipe(recipeId);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ status: 'deleted', recipeId }, null, 2) }],
      };
    }
  );
}
