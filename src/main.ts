import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './config/configure-app';
import { Environment } from './config/environment';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  configureApp(app);
  app.enableShutdownHooks();
  await app.listen(app.get(Environment).port, '0.0.0.0');
}
// Standard Nest entrypoint detected by Vercel's NestJS framework integration.
void bootstrap().catch(() => {
  process.stderr.write(
    'Unitflow startup failed. Check the Firebase environment settings and server logs.\n',
  );
  process.exitCode = 1;
});
