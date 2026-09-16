import { ReadinessController } from './readiness.controller';
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
@Module({ controllers: [HealthController, ReadinessController], providers: [] })
export class HealthModule {}
