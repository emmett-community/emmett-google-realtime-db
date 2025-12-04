// Global test setup

// Aumentar timeout para testes de integração com Firebase Realtime DB
jest.setTimeout(30000);

// Suporte para serialização de BigInt no Jest
// Isso permite que BigInt seja usado em expect() e snapshots
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

// Configuração de variáveis de ambiente para emuladores do Firebase
// Se não estiverem definidas, usa valores padrão para testes locais
process.env.FIREBASE_DATABASE_EMULATOR_HOST =
  process.env.FIREBASE_DATABASE_EMULATOR_HOST || 'localhost:9000';
process.env.FIRESTORE_PROJECT_ID =
  process.env.FIRESTORE_PROJECT_ID || 'test-project';

beforeAll(() => {
  // Setup code if needed
});

afterAll(() => {
  // Cleanup code if needed
});
