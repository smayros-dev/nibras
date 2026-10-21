import { Module } from '@nestjs/common';
import { StructureModule } from '../structure/structure.module';
import { CoursesController } from './courses.controller';
import { CoursesService } from './courses.service';

/**
 * Courses (SP3, spec §4.1): CRUD with optimistic locking, lifecycle, deletion rules and
 * reassignment. Depends on the global `DbModule`, `AuditModule`, `QueueModule` and
 * `ProvidersModule` (`STORAGE_PROVIDER` for cover URLs), and `StructureModule` (the structure
 * read of `GET …/courses/{cid}/structure`, the rich-text check of descriptions). Exports `CoursesService` for the
 * structure, media and enrollment modules.
 */
@Module({
  imports: [StructureModule],
  controllers: [CoursesController],
  providers: [CoursesService],
  exports: [CoursesService],
})
export class CoursesModule {}
