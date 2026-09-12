import { Module } from '@nestjs/common';
import { CoreModule } from './common/core.module';
import { HouseholdsModule } from './households/households.module';
import { ProfilesModule } from './profiles/profiles.module';
import { UnitsModule } from './units/units.module';
import { MembersModule } from './members/members.module';
import { BillingModule } from './billing/billing.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { ActivitiesModule } from './activities/activities.module';
import { HealthModule } from './health/health.module';
import { PhotosModule } from './photos/photos.module';
@Module({
  imports: [
    CoreModule,
    HouseholdsModule,
    ProfilesModule,
    UnitsModule,
    MembersModule,
    BillingModule,
    DashboardModule,
    ActivitiesModule,
    HealthModule,
    PhotosModule,
  ],
})
export class AppModule {}
