// Explicitly invoked by npm run test:emulator; never loaded by the application.
process.env.RUN_FIRESTORE_EMULATOR_TESTS = '1';
process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8085';
