import { Module } from '@nestjs/common';
import { LessonsController } from './lessons.controller';
import { ModulesController } from './modules.controller';
import { RichTextService } from './rich-text.service';
import { StructureService } from './structure.service';

/**
 * Course structure (SP3, spec §4.2): modules and lessons, reorder under deferred unique
 * constraints, typed lesson content and the rich-text whitelist. Depends on the global `DbModule`,
 * `AuditModule` and `ProvidersModule` (`STORAGE_PROVIDER` for inline image URLs). Exports
 * `StructureService` (`GET …/courses/{cid}/structure` lives on the courses controller) and
 * `RichTextService` (course descriptions).
 */
@Module({
  controllers: [ModulesController, LessonsController],
  providers: [StructureService, RichTextService],
  exports: [StructureService, RichTextService],
})
export class StructureModule {}
