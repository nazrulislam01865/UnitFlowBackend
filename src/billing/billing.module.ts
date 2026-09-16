import { ReportsService } from './reports.service';
import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
@Module({ controllers: [BillingController], providers: [BillingService, ReportsService] })
export class BillingModule {}
