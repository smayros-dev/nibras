import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ConsentModule } from './consent.module';
import { MeController } from './me.controller';
import { MeService } from './me.service';
import { PhoneService } from './phone.service';
import { VerificationModule } from './verification.module';

@Module({
  imports: [AuthModule, ConsentModule, VerificationModule],
  controllers: [MeController],
  providers: [MeService, PhoneService],
})
export class MeModule {}
