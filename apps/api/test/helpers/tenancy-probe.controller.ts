import { Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { RequestContext } from '../../src/common/request-context';
import { RequirePermission } from '../../src/tenancy/decorators';

/**
 * Test-only `/workspaces/:wid/…` routes over the tenancy guards (Task 13). Mounted only by specs
 * through `createTestApp({ controllers: [TenancyProbeController] })`: never part of `AppModule`,
 * so never in the OpenAPI snapshot. Each handler echoes what the guards stored in the context.
 */
@Controller('workspaces/:wid/__probe')
export class TenancyProbeController {
  @Get()
  @RequirePermission('workspace.members.read')
  read(): ProbeEcho {
    return echo();
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('workspace.settings.update')
  update(): ProbeEcho {
    return echo();
  }

  @Post('course')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('course.create')
  createCourse(): ProbeEcho {
    return echo();
  }
}

export interface ProbeEcho {
  workspaceId: string | undefined;
  role: string | undefined;
  permissionScope: string | undefined;
}

function echo(): ProbeEcho {
  const store = RequestContext.get();
  return {
    workspaceId: store?.workspace?.id,
    role: store?.membership?.role,
    permissionScope: store?.permissionScope,
  };
}
