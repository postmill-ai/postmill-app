import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { HealthService } from '@gitroom/backend/services/health.service';

@ApiTags('Health')
@Controller('/health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  // Liveness: cheap, dependency-free, always 200. Used by the container HEALTHCHECK and
  // orchestrator liveness probe — answering it only proves the process is up and serving.
  @Get('/live')
  @SkipThrottle()
  getLive() {
    return this.healthService.getLive();
  }

  // Readiness: verifies the hard dependencies (DB + Redis) before the instance should
  // receive traffic. Any failure → 503 with per-dependency status.
  @Get('/ready')
  @SkipThrottle()
  async getReady() {
    return this.healthService.getReady();
  }

  @Get('/')
  @SkipThrottle()
  async getHealth() {
    return this.healthService.getHealth();
  }
}
