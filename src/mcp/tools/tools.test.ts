import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { getFoodById, type MacroFactorClient } from '../../lib/api/index.js';
import { createServer } from '../server.js';
import { describe, expect, it, vi } from 'vitest';
import { searchExercises } from '../../lib/api/exercises.js';
import { syncDayDashboard } from '../../lib/api/sync.js';

vi.mock('../../lib/api/index.js', () => ({
  getFoodById: vi.fn(),
}));

vi.mock('../../lib/api/exercises.js', () => ({
  searchExercises: vi.fn(),
}));

vi.mock('../../lib/api/sync.js', () => ({
  syncDayDashboard: vi.fn().mockResolvedValue(undefined),
}));

type MockClient = {
  getProfile: ReturnType<typeof vi.fn>;
  getGoals: ReturnType<typeof vi.fn>;
  getFoodLog: ReturnType<typeof vi.fn>;
  getNutrition: ReturnType<typeof vi.fn>;
  getWeightEntries: ReturnType<typeof vi.fn>;
  getSteps: ReturnType<typeof vi.fn>;
  getGymProfiles: ReturnType<typeof vi.fn>;
  getCustomExercises: ReturnType<typeof vi.fn>;
  createCustomExercise: ReturnType<typeof vi.fn>;
  getTrainingPrograms: ReturnType<typeof vi.fn>;
  getTrainingProgram: ReturnType<typeof vi.fn>;
  getNextWorkout: ReturnType<typeof vi.fn>;
  getWorkoutHistory: ReturnType<typeof vi.fn>;
  getWorkout: ReturnType<typeof vi.fn>;
  getRawWorkout: ReturnType<typeof vi.fn>;
  getCustomWorkouts: ReturnType<typeof vi.fn>;
  getCustomWorkout: ReturnType<typeof vi.fn>;
  createCustomWorkout: ReturnType<typeof vi.fn>;
  updateCustomWorkout: ReturnType<typeof vi.fn>;
  deleteCustomWorkout: ReturnType<typeof vi.fn>;
  createTrainingProgram: ReturnType<typeof vi.fn>;
  updateTrainingProgram: ReturnType<typeof vi.fn>;
  deleteTrainingProgram: ReturnType<typeof vi.fn>;
  setActiveProgram: ReturnType<typeof vi.fn>;
  markProgramDayCompleted: ReturnType<typeof vi.fn>;
  getRecipes: ReturnType<typeof vi.fn>;
  getRecipe: ReturnType<typeof vi.fn>;
  logRecipe: ReturnType<typeof vi.fn>;
  createRecipe: ReturnType<typeof vi.fn>;
  updateRecipe: ReturnType<typeof vi.fn>;
  deleteRecipe: ReturnType<typeof vi.fn>;
  searchFoods: ReturnType<typeof vi.fn>;
  logFood: ReturnType<typeof vi.fn>;
  logSearchedFood: ReturnType<typeof vi.fn>;
  logWeight: ReturnType<typeof vi.fn>;
  deleteFoodEntry: ReturnType<typeof vi.fn>;
  hardDeleteFoodEntry: ReturnType<typeof vi.fn>;
  updateFoodEntry: ReturnType<typeof vi.fn>;
  updateFoodEntryTime: ReturnType<typeof vi.fn>;
  deleteWeightEntry: ReturnType<typeof vi.fn>;
  deleteWorkout: ReturnType<typeof vi.fn>;
  updateRawWorkout: ReturnType<typeof vi.fn>;
  updateWorkout: ReturnType<typeof vi.fn>;
  copyEntries: ReturnType<typeof vi.fn>;
  syncDay: ReturnType<typeof vi.fn>;
};

function createMockClient(overrides: Partial<MockClient> = {}): MockClient {
  const client: MockClient = {
    getProfile: vi.fn().mockResolvedValue({}),
    getGoals: vi.fn().mockResolvedValue({}),
    getFoodLog: vi.fn().mockResolvedValue([]),
    getNutrition: vi.fn().mockResolvedValue([]),
    getWeightEntries: vi.fn().mockResolvedValue([]),
    getSteps: vi.fn().mockResolvedValue([]),
    getGymProfiles: vi.fn().mockResolvedValue([]),
    getCustomExercises: vi.fn().mockResolvedValue([]),
    createCustomExercise: vi.fn().mockResolvedValue({ id: 'custom-exercise-1', name: 'Custom Exercise' }),
    getTrainingPrograms: vi.fn().mockResolvedValue([]),
    getTrainingProgram: vi.fn().mockResolvedValue(null),
    getNextWorkout: vi.fn().mockResolvedValue(null),
    getWorkoutHistory: vi.fn().mockResolvedValue([]),
    getWorkout: vi.fn().mockResolvedValue({}),
    getRawWorkout: vi.fn().mockResolvedValue({}),
    getCustomWorkouts: vi.fn().mockResolvedValue([]),
    getCustomWorkout: vi.fn().mockResolvedValue(null),
    createCustomWorkout: vi.fn().mockResolvedValue({
      id: 'custom-workout-1',
      workoutPlan: { name: 'Workout', gymId: 'gym-1', blocks: [] },
    }),
    updateCustomWorkout: vi.fn().mockResolvedValue(undefined),
    deleteCustomWorkout: vi.fn().mockResolvedValue(undefined),
    createTrainingProgram: vi.fn().mockResolvedValue({ id: 'program-1' }),
    updateTrainingProgram: vi.fn().mockResolvedValue({ id: 'program-1' }),
    deleteTrainingProgram: vi.fn().mockResolvedValue(undefined),
    setActiveProgram: vi.fn().mockResolvedValue(undefined),
    markProgramDayCompleted: vi.fn().mockResolvedValue(undefined),
    getRecipes: vi.fn().mockResolvedValue([]),
    getRecipe: vi.fn().mockResolvedValue(null),
    logRecipe: vi.fn().mockResolvedValue('recipe-entry-1'),
    createRecipe: vi.fn().mockResolvedValue({ id: 'recipe-1', name: 'Recipe' }),
    updateRecipe: vi.fn().mockResolvedValue({ id: 'recipe-1', name: 'Recipe' }),
    deleteRecipe: vi.fn().mockResolvedValue(undefined),
    searchFoods: vi.fn().mockResolvedValue([]),
    logFood: vi.fn().mockResolvedValue(undefined),
    logSearchedFood: vi.fn().mockResolvedValue(undefined),
    logWeight: vi.fn().mockResolvedValue(undefined),
    deleteFoodEntry: vi.fn().mockResolvedValue(undefined),
    hardDeleteFoodEntry: vi.fn().mockResolvedValue(undefined),
    updateFoodEntry: vi.fn().mockResolvedValue(undefined),
    updateFoodEntryTime: vi.fn().mockResolvedValue(undefined),
    deleteWeightEntry: vi.fn().mockResolvedValue(undefined),
    deleteWorkout: vi.fn().mockResolvedValue(undefined),
    updateRawWorkout: vi.fn().mockResolvedValue(undefined),
    updateWorkout: vi.fn().mockResolvedValue(undefined),
    copyEntries: vi.fn().mockResolvedValue(undefined),
    syncDay: vi.fn().mockResolvedValue(undefined),
  };

  return { ...client, ...overrides };
}

async function connectServer(mockClient: MockClient): Promise<Client> {
  const server = createServer(mockClient as unknown as MacroFactorClient);
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  return client;
}

async function callToolAndParse(mockClient: MockClient, name: string, args: Record<string, unknown> = {}) {
  const client = await connectServer(mockClient);
  const result = await client.callTool({ name, arguments: args });
  expect(result.content).toHaveLength(1);
  return JSON.parse((result.content as any)[0].text);
}

describe('MCP tools', () => {
  it('exposes the expected tool catalog with useful descriptions and annotations', async () => {
    const client = await connectServer(createMockClient());
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name).sort();

    expect(names).toEqual(
      [
        'activate_program',
        'copy_food_entries',
        'create_custom_exercise',
        'create_custom_workout',
        'create_recipe',
        'create_training_program',
        'deactivate_program',
        'delete_custom_workout',
        'delete_food',
        'delete_recipe',
        'delete_training_program',
        'delete_weight',
        'delete_workout',
        'edit_recipe',
        'get_context',
        'get_custom_exercises',
        'get_custom_workout',
        'get_custom_workouts',
        'get_food_log',
        'get_goals',
        'get_gym_profiles',
        'get_next_workout',
        'get_nutrition',
        'get_profile',
        'get_recipe',
        'get_recipes',
        'get_steps',
        'get_training_program',
        'get_training_programs',
        'get_weight_entries',
        'get_workout',
        'get_workouts',
        'log_exercise',
        'log_food',
        'log_manual_food',
        'log_recipe',
        'log_weight',
        'log_workout',
        'remove_exercise',
        'search_exercises',
        'search_foods',
        'update_custom_workout',
        'update_food',
        'update_food_time',
        'update_recipe',
        'update_training_program',
        'update_workout',
        'update_workout_set',
      ].sort()
    );

    expect(names).not.toContain('hard_delete_food');
    for (const tool of tools) {
      expect(tool.description?.length ?? 0).toBeGreaterThan(80);
      expect(tool.inputSchema.type).toBe('object');
    }

    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    for (const name of [
      'get_profile',
      'get_food_log',
      'get_nutrition',
      'get_steps',
      'get_weight_entries',
      'get_workouts',
      'get_training_programs',
      'search_foods',
      'search_exercises',
    ]) {
      expect(byName.get(name)?.annotations?.readOnlyHint).toBe(true);
    }
    for (const name of [
      'delete_food',
      'delete_weight',
      'delete_workout',
      'remove_exercise',
      'delete_recipe',
      'delete_custom_workout',
      'delete_training_program',
    ]) {
      expect(byName.get(name)?.annotations?.destructiveHint).toBe(true);
    }
  });

  it('log_food searches food, logs the result, and triggers dashboard sync', async () => {
    vi.mocked(syncDayDashboard).mockResolvedValue(undefined);
    const food = {
      foodId: 'f1',
      name: 'Milk',
      servings: [
        { description: 'cup', gramWeight: 244, amount: 1 },
        { description: 'gram', gramWeight: 1, amount: 1 },
      ],
      caloriesPer100g: 60,
      proteinPer100g: 3.4,
      carbsPer100g: 5,
      fatPer100g: 3,
      nutrientsPer100g: {},
      brand: 'Brand',
      imageId: '',
    };
    const mockClient = createMockClient({
      searchFoods: vi.fn().mockResolvedValue([food]),
      logSearchedFood: vi.fn().mockResolvedValue(undefined),
    });

    await callToolAndParse(mockClient, 'log_food', {
      query: 'milk',
      amount: 2,
      unit: 'cup',
      date: '2026-03-20',
      hour: 9,
      minute: 45,
    });

    expect(mockClient.searchFoods).toHaveBeenCalledWith('milk');
    expect(mockClient.logSearchedFood).toHaveBeenCalledWith(
      { date: '2026-03-20', hour: 9, minute: 45 },
      food,
      food.servings[0],
      2,
      false
    );
    expect(syncDayDashboard).toHaveBeenCalledWith(mockClient, '2026-03-20');
  });

  it('log_food logs a precise foodId and servingIndex from search results', async () => {
    vi.mocked(syncDayDashboard).mockResolvedValue(undefined);
    const food = {
      foodId: 'f1',
      name: 'Milk',
      servings: [
        { description: 'cup', gramWeight: 244, amount: 1 },
        { description: 'gram', gramWeight: 1, amount: 1 },
      ],
      caloriesPer100g: 60,
      proteinPer100g: 3.4,
      carbsPer100g: 5,
      fatPer100g: 3,
      nutrientsPer100g: {},
      brand: 'Brand',
      imageId: '',
    };
    vi.mocked(getFoodById).mockResolvedValueOnce(food as any);
    const mockClient = createMockClient();

    await callToolAndParse(mockClient, 'log_food', {
      foodId: 'f1',
      servingIndex: 0,
      quantity: 2,
      date: '2026-03-20',
      hour: 9,
      minute: 45,
    });

    expect(getFoodById).toHaveBeenCalledWith('f1');
    expect(mockClient.searchFoods).not.toHaveBeenCalled();
    expect(mockClient.logSearchedFood).toHaveBeenCalledWith(
      { date: '2026-03-20', hour: 9, minute: 45 },
      food,
      food.servings[0],
      2,
      false
    );
    expect(syncDayDashboard).toHaveBeenCalledWith(mockClient, '2026-03-20');
  });

  it('log_manual_food calls client.logFood with LogTime and triggers dashboard sync', async () => {
    vi.mocked(syncDayDashboard).mockResolvedValue(undefined);
    const mockClient = createMockClient();

    await callToolAndParse(mockClient, 'log_manual_food', {
      name: 'Protein Shake',
      calories: 220,
      protein: 35,
      carbs: 12,
      fat: 4,
      date: '2026-03-20',
      hour: 7,
      minute: 5,
    });

    expect(mockClient.logFood).toHaveBeenCalledWith(
      { date: '2026-03-20', hour: 7, minute: 5 },
      'Protein Shake',
      220,
      35,
      12,
      4
    );
    expect(syncDayDashboard).toHaveBeenCalledWith(mockClient, '2026-03-20');
  });

  it('get_profile calls client.getProfile and returns JSON', async () => {
    const mockClient = createMockClient({
      getProfile: vi.fn().mockResolvedValue({ units: 'imperial', weightUnit: 'lbs' }),
    });
    const client = await connectServer(mockClient);
    const result = await client.callTool({ name: 'get_profile', arguments: {} });

    expect(mockClient.getProfile).toHaveBeenCalled();
    expect(result.content).toHaveLength(1);

    const parsed = JSON.parse((result.content as any)[0].text);
    expect(parsed.units).toBe('imperial');
  });

  it('get_goals calls client.getGoals', async () => {
    const mockClient = createMockClient({
      getGoals: vi.fn().mockResolvedValue({ calories: [2000] }),
    });

    const parsed = await callToolAndParse(mockClient, 'get_goals');

    expect(mockClient.getGoals).toHaveBeenCalledTimes(1);
    expect(parsed.calories).toEqual([2000]);
  });

  it('get_gym_profiles calls client.getGymProfiles', async () => {
    const mockClient = createMockClient({
      getGymProfiles: vi.fn().mockResolvedValue([{ id: 'gym-1', name: 'Home Gym' }]),
    });

    const parsed = await callToolAndParse(mockClient, 'get_gym_profiles');

    expect(mockClient.getGymProfiles).toHaveBeenCalledTimes(1);
    expect(parsed[0].id).toBe('gym-1');
  });

  it('get_custom_exercises calls client.getCustomExercises', async () => {
    const mockClient = createMockClient({
      getCustomExercises: vi.fn().mockResolvedValue([{ id: 'c1', name: 'Cable Curl' }]),
    });

    const parsed = await callToolAndParse(mockClient, 'get_custom_exercises');

    expect(mockClient.getCustomExercises).toHaveBeenCalledTimes(1);
    expect(parsed[0].name).toBe('Cable Curl');
  });

  it('create_custom_exercise calls client.createCustomExercise with defaults', async () => {
    const mockClient = createMockClient({
      createCustomExercise: vi.fn().mockResolvedValue({ id: 'c1', name: 'Cable Curl' }),
    });

    const parsed = await callToolAndParse(mockClient, 'create_custom_exercise', { name: 'Cable Curl' });

    expect(mockClient.createCustomExercise).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Cable Curl',
        archived: false,
        exerciseMetrics: expect.any(Array),
      })
    );
    expect(parsed).toEqual({ status: 'created', id: 'c1', name: 'Cable Curl' });
  });

  it('search_exercises calls module searchExercises with query', async () => {
    vi.mocked(searchExercises).mockReturnValueOnce([{ id: 'ex1', name: 'Bench Press' } as any]);
    const mockClient = createMockClient();

    const parsed = await callToolAndParse(mockClient, 'search_exercises', { query: 'bench' });

    expect(searchExercises).toHaveBeenCalledWith('bench');
    expect(parsed[0].id).toBe('ex1');
  });

  it('get_context returns composite context and calls all required client methods', async () => {
    const mockClient = createMockClient({
      getGoals: vi.fn().mockResolvedValue({ calories: [2000], protein: [150], carbs: [200], fat: [70] }),
      getFoodLog: vi.fn().mockResolvedValue([
        {
          deleted: false,
          hour: 8,
          minute: 30,
          calories: () => 500,
          protein: () => 40,
          carbs: () => 60,
          fat: () => 10,
        },
      ]),
      getWeightEntries: vi.fn().mockResolvedValue([{ date: '2026-03-20', weight: 80 }]),
      getTrainingPrograms: vi.fn().mockResolvedValue([{ id: 'p1', name: 'Program', isActive: true }]),
      getNextWorkout: vi.fn().mockResolvedValue({ dayName: 'Day 2', cycleIndex: 1 }),
    });

    const parsed = await callToolAndParse(mockClient, 'get_context');

    expect(mockClient.getGoals).toHaveBeenCalledTimes(1);
    expect(mockClient.getFoodLog).toHaveBeenCalledWith(expect.any(String));
    expect(mockClient.getWeightEntries).toHaveBeenCalledWith(expect.any(String), expect.any(String));
    expect(mockClient.getTrainingPrograms).toHaveBeenCalledTimes(1);
    expect(mockClient.getNextWorkout).toHaveBeenCalledTimes(1);
    expect(parsed).toHaveProperty('goals');
    expect(parsed).toHaveProperty('today');
    expect(parsed).toHaveProperty('recentWeight');
    expect(parsed).toHaveProperty('program');
    expect(parsed).toHaveProperty('lastMeal');
  });

  it('get_food_log defaults date and filters deleted entries', async () => {
    const active = {
      entryId: '1',
      deleted: false,
      calories: () => 100,
      protein: () => 10,
      carbs: () => 0,
      fat: () => 0,
    };
    const deleted = {
      entryId: '2',
      deleted: true,
      calories: () => 100,
      protein: () => 10,
      carbs: () => 0,
      fat: () => 0,
    };
    const mockClient = createMockClient({ getFoodLog: vi.fn().mockResolvedValue([active, deleted]) });

    const parsed = await callToolAndParse(mockClient, 'get_food_log');

    expect(mockClient.getFoodLog).toHaveBeenCalledWith(expect.any(String));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].entryId).toBe('1');
  });

  it('search_foods calls client.searchFoods', async () => {
    const mockClient = createMockClient({
      searchFoods: vi.fn().mockResolvedValue([{ foodId: 'f1', name: 'Greek Yogurt' }]),
    });

    const parsed = await callToolAndParse(mockClient, 'search_foods', { query: 'yogurt' });

    expect(mockClient.searchFoods).toHaveBeenCalledWith('yogurt');
    expect(parsed[0].foodId).toBe('f1');
  });

  it('update_food calls client.updateFoodEntry', async () => {
    const mockClient = createMockClient();

    await callToolAndParse(mockClient, 'update_food', { date: '2026-03-20', entryId: '123', quantity: 2.5 });

    expect(mockClient.updateFoodEntry).toHaveBeenCalledWith('2026-03-20', '123', 2.5);
  });

  it('update_food_time calls client.updateFoodEntryTime', async () => {
    const mockClient = createMockClient();

    await callToolAndParse(mockClient, 'update_food_time', {
      date: '2026-03-20',
      entryId: '123',
      hour: 12,
      minute: 15,
    });

    expect(mockClient.updateFoodEntryTime).toHaveBeenCalledWith('2026-03-20', '123', 12, 15);
  });

  it('delete_food calls client.deleteFoodEntry', async () => {
    const mockClient = createMockClient();

    await callToolAndParse(mockClient, 'delete_food', { date: '2026-03-20', entryId: '123' });

    expect(mockClient.deleteFoodEntry).toHaveBeenCalledWith('2026-03-20', '123');
  });

  it('copy_food_entries fetches source log and calls client.copyEntries', async () => {
    const entry = { entryId: 'a1', date: '2026-03-20', deleted: false };
    const mockClient = createMockClient({ getFoodLog: vi.fn().mockResolvedValue([entry]) });

    await callToolAndParse(mockClient, 'copy_food_entries', {
      fromDate: '2026-03-20',
      toDate: '2026-03-21',
      entryIds: ['a1'],
    });

    expect(mockClient.getFoodLog).toHaveBeenCalledWith('2026-03-20');
    expect(mockClient.copyEntries).toHaveBeenCalledWith('2026-03-21', [entry]);
  });

  it('get_nutrition calls client.getNutrition with date range', async () => {
    const mockClient = createMockClient({ getNutrition: vi.fn().mockResolvedValue([{ date: '2026-03-20' }]) });

    const parsed = await callToolAndParse(mockClient, 'get_nutrition', {
      startDate: '2026-03-01',
      endDate: '2026-03-20',
    });

    expect(mockClient.getNutrition).toHaveBeenCalledWith('2026-03-01', '2026-03-20');
    expect(parsed[0].date).toBe('2026-03-20');
  });

  it('get_steps calls client.getSteps with date range', async () => {
    const mockClient = createMockClient({
      getSteps: vi.fn().mockResolvedValue([{ date: '2026-03-20', steps: 10000 }]),
    });

    const parsed = await callToolAndParse(mockClient, 'get_steps', {
      startDate: '2026-03-01',
      endDate: '2026-03-20',
    });

    expect(mockClient.getSteps).toHaveBeenCalledWith('2026-03-01', '2026-03-20');
    expect(parsed[0].steps).toBe(10000);
  });

  it('get_weight_entries calls client.getWeightEntries', async () => {
    const mockClient = createMockClient({
      getWeightEntries: vi.fn().mockResolvedValue([{ date: '2026-03-20', weight: 81 }]),
    });

    const parsed = await callToolAndParse(mockClient, 'get_weight_entries', {
      startDate: '2026-03-01',
      endDate: '2026-03-20',
    });

    expect(mockClient.getWeightEntries).toHaveBeenCalledWith('2026-03-01', '2026-03-20');
    expect(parsed[0].weight).toBe(81);
  });

  it('log_weight converts lbs to kg and calls client.logWeight', async () => {
    const mockClient = createMockClient();

    await callToolAndParse(mockClient, 'log_weight', { lbs: 220, date: '2026-03-20', bodyFat: 18.2 });

    expect(mockClient.logWeight).toHaveBeenCalledWith('2026-03-20', 220 / 2.2046226218, 18.2);
  });

  it('log_weight rejects ambiguous unit input', async () => {
    const client = await connectServer(createMockClient());

    const result = await client.callTool({ name: 'log_weight', arguments: { lbs: 220, kg: 100, date: '2026-03-20' } });

    expect(result.isError).toBe(true);
    expect((result.content as any)[0].text).toMatch(/exactly one of kg or lbs/);
  });

  it('delete_weight calls client.deleteWeightEntry', async () => {
    const mockClient = createMockClient();

    await callToolAndParse(mockClient, 'delete_weight', { date: '2026-03-20' });

    expect(mockClient.deleteWeightEntry).toHaveBeenCalledWith('2026-03-20');
  });

  it('recipe tools wire through list, get, log, create, update, edit, and delete flows', async () => {
    const existingRecipe = {
      id: 'recipe-1',
      name: 'Chili',
      servings: 4,
      caloriesPerServing: 250,
      proteinPerServing: 20,
      ingredients: [{ name: 'Beans', calories: 400, protein: 20, carbs: 60, fat: 2, quantity: 2, unit: 'cup' }],
      steps: ['Cook'],
    };
    const mockClient = createMockClient({
      getRecipes: vi.fn().mockResolvedValue([existingRecipe]),
      getRecipe: vi.fn().mockResolvedValue(existingRecipe),
      logRecipe: vi.fn().mockResolvedValue('entry-1'),
      createRecipe: vi.fn().mockResolvedValue({ ...existingRecipe, id: 'recipe-2' }),
      updateRecipe: vi.fn().mockResolvedValue({ ...existingRecipe, name: 'Chili Updated' }),
    });

    const recipes = await callToolAndParse(mockClient, 'get_recipes');
    expect(recipes[0].id).toBe('recipe-1');

    const recipe = await callToolAndParse(mockClient, 'get_recipe', { recipeId: 'recipe-1' });
    expect(recipe.name).toBe('Chili');

    await callToolAndParse(mockClient, 'log_recipe', {
      recipeId: 'recipe-1',
      servings: 2,
      date: '2026-03-20',
      hour: 18,
      minute: 30,
    });
    expect(mockClient.logRecipe).toHaveBeenCalledWith({ date: '2026-03-20', hour: 18, minute: 30 }, 'recipe-1', 2);

    const input = {
      name: 'Chili',
      servings: 4,
      ingredients: [{ name: 'Beans', calories: 400, protein: 20, carbs: 60, fat: 2 }],
    };
    await callToolAndParse(mockClient, 'create_recipe', input);
    expect(mockClient.createRecipe).toHaveBeenCalledWith(input);

    await callToolAndParse(mockClient, 'update_recipe', { recipeId: 'recipe-1', ...input, name: 'Chili Updated' });
    expect(mockClient.updateRecipe).toHaveBeenCalledWith(
      'recipe-1',
      expect.objectContaining({ name: 'Chili Updated' })
    );

    await callToolAndParse(mockClient, 'edit_recipe', {
      recipeId: 'recipe-1',
      ingredientEdits: [{ ingredientName: 'Beans', action: 'scale', newQuantity: 3 }],
    });
    expect(mockClient.updateRecipe).toHaveBeenLastCalledWith(
      'recipe-1',
      expect.objectContaining({
        ingredients: [expect.objectContaining({ name: 'Beans', quantity: 3, calories: 600 })],
      })
    );

    await callToolAndParse(mockClient, 'delete_recipe', { recipeId: 'recipe-1' });
    expect(mockClient.deleteRecipe).toHaveBeenCalledWith('recipe-1');
  });

  it('get_workouts calls client.getWorkoutHistory and filters by range', async () => {
    const mockClient = createMockClient({
      getWorkoutHistory: vi.fn().mockResolvedValue([
        { id: 'w1', startTime: '2026-03-01T10:00:00.000Z' },
        { id: 'w2', startTime: '2026-03-15T10:00:00.000Z' },
        { id: 'w3', startTime: '2026-03-25T10:00:00.000Z' },
      ]),
    });

    const parsed = await callToolAndParse(mockClient, 'get_workouts', {
      from: '2026-03-10',
      to: '2026-03-20',
    });

    expect(mockClient.getWorkoutHistory).toHaveBeenCalledTimes(1);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe('w2');
  });

  it('get_workout calls client.getWorkout', async () => {
    const mockClient = createMockClient({
      getWorkout: vi.fn().mockResolvedValue({ id: 'w1', name: 'Upper Body' }),
    });

    const parsed = await callToolAndParse(mockClient, 'get_workout', { id: 'w1' });

    expect(mockClient.getWorkout).toHaveBeenCalledWith('w1');
    expect(parsed.name).toBe('Upper Body');
  });

  it('get_training_program returns active program', async () => {
    const mockClient = createMockClient({
      getTrainingPrograms: vi.fn().mockResolvedValue([
        { id: 'p1', isActive: false },
        { id: 'p2', isActive: true, name: 'Active Program' },
      ]),
    });

    const parsed = await callToolAndParse(mockClient, 'get_training_program');

    expect(mockClient.getTrainingPrograms).toHaveBeenCalledTimes(1);
    expect(parsed.id).toBe('p2');
  });

  it('get_training_program can fetch a specific program by id', async () => {
    const mockClient = createMockClient({
      getTrainingProgram: vi.fn().mockResolvedValue({ id: 'p1', name: 'Specific Program' }),
    });

    const parsed = await callToolAndParse(mockClient, 'get_training_program', { id: 'p1' });

    expect(mockClient.getTrainingProgram).toHaveBeenCalledWith('p1');
    expect(mockClient.getTrainingPrograms).not.toHaveBeenCalled();
    expect(parsed.name).toBe('Specific Program');
  });

  it('get_next_workout calls client.getNextWorkout', async () => {
    const mockClient = createMockClient({
      getNextWorkout: vi.fn().mockResolvedValue({ dayName: 'Day 3' }),
    });

    const parsed = await callToolAndParse(mockClient, 'get_next_workout');

    expect(mockClient.getNextWorkout).toHaveBeenCalledTimes(1);
    expect(parsed.dayName).toBe('Day 3');
  });

  it('log_workout builds workout blocks and calls client.updateRawWorkout', async () => {
    vi.mocked(searchExercises).mockReturnValueOnce([{ id: 'ex-bench', name: 'Bench Press' } as any]);
    const mockClient = createMockClient({
      getGymProfiles: vi.fn().mockResolvedValue([{ id: 'gym-1', name: 'Home Gym', icon: 'house' }]),
    });

    await callToolAndParse(mockClient, 'log_workout', {
      name: 'Push Day',
      gym: 'Home Gym',
      startTime: '2026-03-20T17:00:00',
      durationMinutes: 60,
      exercises: [{ name: 'Bench Press', sets: [{ reps: 8, lbs: 225, sets: 2, rest: 180 }] }],
    });

    expect(searchExercises).toHaveBeenCalledWith('Bench Press');
    expect(mockClient.updateRawWorkout).toHaveBeenCalledTimes(1);

    const [id, workout, fieldPaths] = mockClient.updateRawWorkout.mock.calls[0];
    expect(typeof id).toBe('string');
    expect(workout.name).toBe('Push Day');
    expect(workout.blocks).toHaveLength(1);
    expect(workout.blocks[0].exercises).toHaveLength(1);
    expect(workout.blocks[0].exercises[0].exerciseId).toBe('ex-bench');
    expect(workout.blocks[0].exercises[0].sets).toHaveLength(2);
    expect(fieldPaths).toEqual(
      expect.arrayContaining(['name', 'startTime', 'duration', 'gymId', 'gymName', 'gymIcon', 'blocks'])
    );
  });

  it('log_exercise appends exercises to existing workout blocks', async () => {
    vi.mocked(searchExercises).mockReturnValueOnce([{ id: 'ex-row', name: 'Cable Row' } as any]);
    const mockClient = createMockClient({
      getRawWorkout: vi.fn().mockResolvedValue({ blocks: [{ exercises: [{ exerciseId: 'existing' }] }] }),
    });

    await callToolAndParse(mockClient, 'log_exercise', {
      workoutId: 'w1',
      exercises: [{ name: 'Cable Row', sets: [{ reps: 12, kg: 40 }] }],
    });

    expect(mockClient.getRawWorkout).toHaveBeenCalledWith('w1');
    expect(mockClient.updateRawWorkout).toHaveBeenCalledTimes(1);
    const [, payload, paths] = mockClient.updateRawWorkout.mock.calls[0];
    expect(payload.blocks).toHaveLength(2);
    expect(paths).toEqual(['blocks']);
  });

  it('update_workout forwards fields to client.updateWorkout', async () => {
    const mockClient = createMockClient();

    await callToolAndParse(mockClient, 'update_workout', {
      id: 'w1',
      name: 'Renamed Session',
      durationMinutes: 50,
    });

    expect(mockClient.updateWorkout).toHaveBeenCalledWith('w1', {
      name: 'Renamed Session',
      durationMinutes: 50,
    });
  });

  it('delete_workout calls client.deleteWorkout', async () => {
    const mockClient = createMockClient();

    await callToolAndParse(mockClient, 'delete_workout', { id: 'w1' });

    expect(mockClient.deleteWorkout).toHaveBeenCalledWith('w1');
  });

  it('remove_exercise filters blocks and updates workout', async () => {
    const mockClient = createMockClient({
      getRawWorkout: vi.fn().mockResolvedValue({
        blocks: [{ exercises: [{ exerciseId: 'ex1' }] }, { exercises: [{ exerciseId: 'ex2' }] }],
      }),
    });

    await callToolAndParse(mockClient, 'remove_exercise', { workoutId: 'w1', exerciseId: 'ex1' });

    expect(mockClient.getRawWorkout).toHaveBeenCalledWith('w1');
    expect(mockClient.updateRawWorkout).toHaveBeenCalledWith(
      'w1',
      { blocks: [{ exercises: [{ exerciseId: 'ex2' }] }] },
      ['blocks']
    );
  });

  it('update_workout_set updates one set by exercise instance id', async () => {
    const mockClient = createMockClient({
      getRawWorkout: vi.fn().mockResolvedValue({
        blocks: [
          {
            exercises: [
              {
                id: 'instance-1',
                exerciseId: 'ex1',
                sets: [
                  {
                    setType: 'standard',
                    log: {
                      value: {
                        weight: 100,
                        fullReps: 5,
                        rir: null,
                        restTimer: 120_000_000,
                        isSkipped: false,
                      },
                    },
                  },
                ],
              },
            ],
          },
        ],
      }),
    });

    await callToolAndParse(mockClient, 'update_workout_set', {
      workoutId: 'w1',
      exerciseInstanceId: 'instance-1',
      setIndex: 0,
      reps: 6,
      lbs: 225,
      rir: 1,
      rest: 180,
    });

    const [, payload, paths] = mockClient.updateRawWorkout.mock.calls[0];
    const updatedSet = payload.blocks[0].exercises[0].sets[0];
    expect(paths).toEqual(['blocks']);
    expect(updatedSet.log.value.fullReps).toBe(6);
    expect(updatedSet.log.value.weight).toBe(225 / 2.2046226218);
    expect(updatedSet.log.value.rir).toBe(1);
    expect(updatedSet.log.value.restTimer).toBe(180_000_000);
  });

  it('custom workout tools wire through list, get, create, update, and delete flows', async () => {
    vi.mocked(searchExercises).mockReturnValue([{ id: 'ex-squat', name: 'Squat' } as any]);
    const customWorkout = {
      id: 'cw1',
      workoutPlan: {
        name: 'Leg Day',
        gymId: 'gym-1',
        blocks: [{ exercises: [{ exerciseId: 'ex-squat', target: { sets: [] } }] }],
      },
    };
    const mockClient = createMockClient({
      getGymProfiles: vi.fn().mockResolvedValue([{ id: 'gym-1', name: 'Home Gym', icon: 'house' }]),
      getCustomWorkouts: vi.fn().mockResolvedValue([customWorkout]),
      getCustomWorkout: vi.fn().mockResolvedValue(customWorkout),
      createCustomWorkout: vi.fn().mockResolvedValue(customWorkout),
      updateCustomWorkout: vi.fn().mockResolvedValue(undefined),
    });

    const list = await callToolAndParse(mockClient, 'get_custom_workouts');
    expect(list[0]).toEqual(expect.objectContaining({ id: 'cw1', name: 'Leg Day' }));

    const detail = await callToolAndParse(mockClient, 'get_custom_workout', { id: 'cw1' });
    expect(detail.id).toBe('cw1');

    await callToolAndParse(mockClient, 'create_custom_workout', {
      name: 'Leg Day',
      gym: 'Home Gym',
      exercises: [{ name: 'Squat', sets: [{ reps: '5-8', sets: 3, rir: 2 }] }],
    });
    expect(mockClient.createCustomWorkout).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Leg Day', gymId: 'gym-1', blocks: expect.any(Array) })
    );

    await callToolAndParse(mockClient, 'update_custom_workout', {
      id: 'cw1',
      name: 'Leg Day Updated',
      gym: 'Home Gym',
      exercises: [{ name: 'Squat', sets: [{ reps: 5, sets: 3 }] }],
    });
    expect(mockClient.updateCustomWorkout).toHaveBeenCalledWith(
      'cw1',
      expect.objectContaining({ name: 'Leg Day Updated', gymId: 'gym-1' })
    );

    await callToolAndParse(mockClient, 'delete_custom_workout', { id: 'cw1' });
    expect(mockClient.deleteCustomWorkout).toHaveBeenCalledWith('cw1');
  });

  it('training program tools wire through list, create, update, activate, deactivate, and delete flows', async () => {
    vi.mocked(searchExercises).mockReturnValue([{ id: 'ex-bench', name: 'Bench Press' } as any]);
    const program = {
      id: 'program-1',
      name: 'Strength',
      numCycles: 4,
      isPeriodized: false,
      deload: 'none',
      isActive: false,
      days: [{ name: 'Day 1', isRestDay: false }],
    };
    const mockClient = createMockClient({
      getGymProfiles: vi.fn().mockResolvedValue([{ id: 'gym-1', name: 'Home Gym', icon: 'house' }]),
      getTrainingPrograms: vi.fn().mockResolvedValue([program]),
      getTrainingProgram: vi.fn().mockResolvedValue(program),
      createTrainingProgram: vi.fn().mockResolvedValue(program),
      updateTrainingProgram: vi.fn().mockResolvedValue({ ...program, name: 'Strength Updated' }),
    });
    const programInput = {
      name: 'Strength',
      gym: 'Home Gym',
      numCycles: 4,
      days: [{ name: 'Day 1', exercises: [{ name: 'Bench Press', sets: [{ reps: '5-8', sets: 3, rir: 2 }] }] }],
    };

    const list = await callToolAndParse(mockClient, 'get_training_programs');
    expect(list[0]).toEqual(expect.objectContaining({ id: 'program-1', name: 'Strength' }));

    await callToolAndParse(mockClient, 'create_training_program', programInput);
    expect(mockClient.createTrainingProgram).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Strength', gymId: 'gym-1', days: expect.any(Array) })
    );

    await callToolAndParse(mockClient, 'update_training_program', { id: 'program-1', ...programInput });
    expect(mockClient.updateTrainingProgram).toHaveBeenCalledWith(
      'program-1',
      expect.objectContaining({ name: 'Strength', gymId: 'gym-1', days: expect.any(Array) })
    );

    const activated = await callToolAndParse(mockClient, 'activate_program', { id: 'program-1' });
    expect(mockClient.setActiveProgram).toHaveBeenCalledWith('program-1');
    expect(activated).toEqual({ status: 'activated', id: 'program-1', name: 'Strength' });

    await callToolAndParse(mockClient, 'deactivate_program');
    expect(mockClient.setActiveProgram).toHaveBeenCalledWith(null);

    await callToolAndParse(mockClient, 'delete_training_program', { id: 'program-1' });
    expect(mockClient.deleteTrainingProgram).toHaveBeenCalledWith('program-1');
  });
});
