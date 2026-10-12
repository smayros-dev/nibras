import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ConsentModule } from './consent.module';
import { MeController } from './me.controller';
import { MeService } from './me.service';

@Module({
  imports: [AuthModule, ConsentModule],
  controllers: [MeController],
  providers: [MeService],
})
export class MeModule {}
