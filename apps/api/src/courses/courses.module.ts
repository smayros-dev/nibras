import { Module } from '@nestjs/common';
import { CoursesController } from './courses.controller';
import { CoursesService } from './courses.service';

/**
 * Courses (SP3, spec §4.1): CRUD with optimistic locking, lifecycle, deletion rules and
 * reassignment. Depends on the global `DbModule`, `AuditModule`, `QueueModule` and
 * `ProvidersModule` (`STORAGE_PROVIDER` for cover URLs). Exports `CoursesService` for the
 * structure, media and enrollment modules.
 */
@Module({
  controllers: [CoursesController],
  providers: [CoursesService],
  exports: [CoursesService],
})
export class CoursesModule {}
