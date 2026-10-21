import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { StructureModule } from '../structure/structure.module';
import { LearnController } from './learn.controller';
import { LearnService } from './learn.service';
import { LockService } from './lock.service';
import { ProgressService } from './progress.service';

/**
 * The student's learning routes (SP3, spec §4.6): `/me/courses`, the outline with locks, lesson
 * content, playback and download, manual completion and the progress percent. Imports
 * `MediaModule` (`PlaybackService`) and `StructureModule` (`RichTextService`, inline images);
 * depends on the global `DbModule`, `RedisModule` and `ProvidersModule`.
 */
@Module({
  imports: [MediaModule, StructureModule],
  controllers: [LearnController],
  providers: [LearnService, ProgressService, LockService],
  exports: [ProgressService],
})
export class LearnModule {}
