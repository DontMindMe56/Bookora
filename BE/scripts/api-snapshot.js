process.env.NODE_ENV = 'test';
const { createApp } = await import('../src/app.js');
const { buildOpenApi } = await import('../src/docs/openapi.js');
process.stdout.write(JSON.stringify(buildOpenApi(createApp()), null, 1) + '\n', () => process.exit(0));
