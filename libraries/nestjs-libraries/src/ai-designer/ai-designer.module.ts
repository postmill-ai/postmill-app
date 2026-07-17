import { Module } from '@nestjs/common';
import { AiModule } from '@gitroom/nestjs-libraries/ai/ai.module';
import { AiDesignerService } from './ai-designer.service';
import { AiDesignerSessionRepository } from '@gitroom/nestjs-libraries/database/prisma/ai-designer/ai-designer-session.repository';
import { AiDesignerMessageRepository } from '@gitroom/nestjs-libraries/database/prisma/ai-designer/ai-designer-message.repository';
import { AiDesignerBudgetGuard } from './guards/ai-designer-budget.guard';
import { AiDesignerDefaultsGate } from './guards/ai-designer-defaults.gate';
import { AiDesignerIdempotencyService } from './ai-designer-idempotency.service';
import { AiDesignerAgentMeshModule } from './agent-mesh/ai-designer-agent-mesh.module';
import { AiDesignerConversationalistService } from './agents/conversationalist/ai-designer-conversationalist.service';
import { AiDesignerArtDirectorService } from './agents/art-director/ai-designer-art-director.service';
import { AiDesignerCopywriterService } from './agents/copywriter/ai-designer-copywriter.service';
import { AiDesignerAssetService } from './agents/asset/ai-designer-asset.service';
import { AiDesignerComposerService } from './agents/composer/ai-designer-composer.service';
import { AiDesignerVisionCriticService } from './agents/vision-critic/ai-designer-vision-critic.service';
import { AiDesignerSaverService } from './ai-designer-saver.service';
import { AiDesignerSkillRouter } from './skills/ai-designer-skill-router.service';
import { AiDesignerConductorService } from './conductor/ai-designer-conductor.service';
import { AiDesignerInputPolicyService } from './ai-designer-input-policy.service';

@Module({
  imports: [AiModule, AiDesignerAgentMeshModule],
  providers: [
    AiDesignerService,
    AiDesignerSessionRepository,
    AiDesignerMessageRepository,
    AiDesignerBudgetGuard,
    AiDesignerDefaultsGate,
    AiDesignerIdempotencyService,
    AiDesignerConversationalistService,
    AiDesignerArtDirectorService,
    AiDesignerCopywriterService,
    AiDesignerAssetService,
    AiDesignerComposerService,
    AiDesignerVisionCriticService,
    AiDesignerSaverService,
    AiDesignerSkillRouter,
    AiDesignerConductorService,
    AiDesignerInputPolicyService,
  ],
  exports: [
    AiDesignerService,
    AiDesignerBudgetGuard,
    AiDesignerDefaultsGate,
    AiDesignerIdempotencyService,
    AiDesignerConversationalistService,
    AiDesignerArtDirectorService,
    AiDesignerCopywriterService,
    AiDesignerAssetService,
    AiDesignerComposerService,
    AiDesignerVisionCriticService,
    AiDesignerSaverService,
    AiDesignerSkillRouter,
    AiDesignerConductorService,
    AiDesignerInputPolicyService,
  ],
})
export class AiDesignerModule {}
