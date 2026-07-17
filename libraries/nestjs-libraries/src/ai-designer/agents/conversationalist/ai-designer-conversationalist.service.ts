import '@gitroom/nestjs-libraries/ai-designer/agent-mesh/agent-mesh-env.shim';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  registerInProcessAgent,
  type InProcessHandler,
} from '@reaatech/agent-mesh-router';
import type { AgentConfig, AgentResponse, ContextPacket } from '@reaatech/agent-mesh';
import { AIModelProvider } from '@gitroom/nestjs-libraries/ai/ai-model.provider';
import type {
  DesignBrief,
  FormField,
  RevisionRequest,
} from '../../ai-designer.types';
import {
  isAgentInputError,
  parseAgentInput,
} from '../../util/parse-agent-input';

interface ChatInput {
  type: 'chat';
  text: string;
  session: {
    mode: 'chat' | 'prompt';
    state: 'intake' | 'planning' | 'awaiting_plan' | 'executing' | 'delivered' | 'revising';
    brief: DesignBrief;
    questionsAsked: string[];
    activeDesignIds?: string[];
  };
}

interface ClassificationResult {
  intent: 'clarify' | 'revise' | 'accept' | 'general';
  text: string;
  fields?: FormField[];
  revision?: Partial<RevisionRequest>;
}

@Injectable()
export class AiDesignerConversationalistService implements OnModuleInit {
  private readonly _logger = new Logger(AiDesignerConversationalistService.name);

  constructor(private readonly _ai: AIModelProvider) {}

  onModuleInit() {
    registerInProcessAgent('conversationalist', this._handler.bind(this));
  }

  private _handler: InProcessHandler = async (
    context: ContextPacket,
    _agent: AgentConfig
  ): Promise<AgentResponse> => {
    const parsed = parseAgentInput<ChatInput>(context.raw_input);
    if (isAgentInputError(parsed)) {
      return {
        content: JSON.stringify(parsed),
        workflow_complete: false,
      };
    }
    const input = this._normalizeInput(parsed);
    const orgId = this._extractOrgId(context);

    const classification = await this._classify(input, orgId);

    const content = this._buildResponse(input, classification);

    return {
      content: JSON.stringify(content),
      workflow_complete: false,
    };
  };

  private _normalizeInput(parsed: ChatInput): ChatInput {
    return {
      type: parsed.type ?? 'chat',
      text: parsed.text ?? '',
      session: {
        mode: parsed.session?.mode ?? 'chat',
        state: parsed.session?.state ?? 'intake',
        brief: parsed.session?.brief ?? { intent: '' },
        questionsAsked: parsed.session?.questionsAsked ?? [],
        activeDesignIds: parsed.session?.activeDesignIds,
      },
    };
  }

  private _extractOrgId(context: ContextPacket): string | undefined {
    const orgId = context.metadata?.orgId;
    return typeof orgId === 'string' ? orgId : undefined;
  }

  private async _classify(
    input: ChatInput,
    orgId: string | undefined
  ): Promise<ClassificationResult> {
    const { session, text } = input;

    const system = [
      'You are the conversationalist agent for the AI Designer feature in Postmill.',
      'Read the user message and current session state, then classify intent and return JSON.',
      '',
      'Possible intents:',
      '- clarify: more information is needed before creating or changing a design. Ask a focused question and optionally include form fields.',
      '- revise: the user wants to change an already-delivered design. Extract the revision instruction and any targets.',
      '- accept: the user is satisfied with the current plan or delivered design.',
      '- general: greeting, small talk, or anything else.',
      '',
      'Return ONLY a JSON object with this schema:',
      '{',
      '  "intent": "clarify" | "revise" | "accept" | "general",',
      '  "text": "concise friendly response to the user",',
      '  "fields": [ ... ], // only when intent is "clarify"',
      '  "revision": { // only when intent is "revise"',
      '    "instruction": "the exact change requested",',
      '    "targetDesignId": "optional design id mentioned by the user",',
      '    "scope": "shared" | "format-only",',
      '    "targetOutputs": ["optional output/format ids"],',
      '    "targetSlots": ["optional slot ids"]',
      '  }',
      '}',
      '',
      'For revise scope, use "shared" for changes that should apply to every output (copy, colors, overall layout) and "format-only" for changes that target specific formats or sizes.',
      'If the user refers to "this one", "the first one", or similar without an id, prefer the first activeDesignId.',
    ].join('\n');

    const prompt = [
      `User message: "${text}"`,
      '',
      'Current session state:',
      `- mode: ${session.mode}`,
      `- state: ${session.state}`,
      `- brief so far: ${JSON.stringify(session.brief)}`,
      `- questions already asked: ${JSON.stringify(session.questionsAsked)}`,
      `- active design ids: ${JSON.stringify(session.activeDesignIds ?? [])}`,
      '',
      'What is the user\'s intent? Return the JSON object described in your instructions.',
    ].join('\n');

    try {
      const raw = await this._ai.generateText('utility', prompt, { system, orgId });
      const cleaned = this._stripMarkdownFences(raw);
      const parsed = JSON.parse(cleaned) as Partial<ClassificationResult>;

      if (
        parsed.intent &&
        ['clarify', 'revise', 'accept', 'general'].includes(parsed.intent)
      ) {
        return {
          intent: parsed.intent as ClassificationResult['intent'],
          text: typeof parsed.text === 'string' ? parsed.text : '',
          fields: Array.isArray(parsed.fields) ? parsed.fields : undefined,
          revision: parsed.revision,
        };
      }
    } catch (err) {
      this._logger.warn(`Conversationalist classification failed: ${(err as Error).message}`);
    }

    return { intent: 'general', text: text || 'How can I help?' };
  }

  private _stripMarkdownFences(raw: string): string {
    const trimmed = raw.trim();
    if (trimmed.startsWith('```')) {
      const withoutPrefix = trimmed.replace(/^```[a-zA-Z]*\n?/, '');
      return withoutPrefix.replace(/\n?```$/, '');
    }
    return trimmed;
  }

  private _buildResponse(
    input: ChatInput,
    classification: ClassificationResult
  ): unknown {
    const { session } = input;

    // Intake: gather missing required brief fields before planning.
    if (session.state === 'intake') {
      const missingFields = this._missingRequiredFields(session.brief);
      if (missingFields.length > 0) {
        const fields =
          classification.intent === 'clarify' && classification.fields?.length
            ? classification.fields
            : this._defaultFieldsFor(missingFields, session.questionsAsked);

        const prompt =
          classification.text && classification.intent === 'clarify'
            ? classification.text
            : 'Before I can plan the design, I need a little more information.';

        return {
          type: 'form',
          prompt,
          fields,
        };
      }
    }

    // Delivered / revising: parse revision requests.
    if (session.state === 'delivered' || session.state === 'revising') {
      if (classification.intent === 'revise') {
        const revision = this._normalizeRevision(
          classification.revision,
          input.text,
          session.activeDesignIds
        );
        return { type: 'revision', revision };
      }

      if (classification.intent === 'accept') {
        return {
          type: 'reply',
          text:
            classification.text ||
            'Great! Let me know if you need any other changes.',
        };
      }
    }

    // Default: general narration / reply.
    return {
      type: 'reply',
      text:
        classification.text ||
        'I\'m not sure I understood. Can you tell me more about what you\'d like to design?',
    };
  }

  private _missingRequiredFields(brief: DesignBrief): string[] {
    const required = ['intent', 'audience', 'tone'];
    return required.filter((field) => {
      const value = brief[field];
      return value === undefined || value === null || value === '';
    });
  }

  private _defaultFieldsFor(
    missing: string[],
    questionsAsked: string[]
  ): FormField[] {
    const definitions: Record<string, FormField> = {
      intent: {
        name: 'intent',
        type: 'text',
        label: 'What is this post about?',
        placeholder: 'e.g. A meme about remote work',
      },
      audience: {
        name: 'audience',
        type: 'text',
        label: 'Who is the audience?',
        placeholder: 'e.g. Instagram followers',
      },
      tone: {
        name: 'tone',
        type: 'select',
        label: 'What tone should it have?',
        options: [
          { value: 'funny', label: 'Funny' },
          { value: 'professional', label: 'Professional' },
          { value: 'playful', label: 'Playful' },
          { value: 'inspiring', label: 'Inspiring' },
          { value: 'urgent', label: 'Urgent' },
        ],
      },
    };

    // Prefer fields that have not been asked yet, then any remaining missing fields.
    const ordered = missing.sort((a, b) => {
      const aAsked = questionsAsked.includes(a) ? 1 : 0;
      const bAsked = questionsAsked.includes(b) ? 1 : 0;
      return aAsked - bAsked;
    });

    return ordered
      .slice(0, 3)
      .map((field) => definitions[field])
      .filter((field): field is FormField => !!field);
  }

  private _normalizeRevision(
    revision: Partial<RevisionRequest> | undefined,
    fallbackText: string,
    activeDesignIds?: string[]
  ): RevisionRequest {
    const instruction =
      typeof revision?.instruction === 'string' && revision.instruction.trim().length > 0
        ? revision.instruction.trim()
        : fallbackText.trim() || 'Apply the requested change';

    let targetDesignId: string | undefined =
      typeof revision?.targetDesignId === 'string'
        ? revision.targetDesignId
        : undefined;

    if (!targetDesignId && activeDesignIds && activeDesignIds.length > 0) {
      targetDesignId = activeDesignIds[0];
    }

    const scope: RevisionRequest['scope'] =
      revision?.scope === 'format-only' ? 'format-only' : 'shared';

    const targetOutputs = Array.isArray(revision?.targetOutputs)
      ? revision.targetOutputs.filter((id): id is string => typeof id === 'string')
      : undefined;

    const targetSlots = Array.isArray(revision?.targetSlots)
      ? revision.targetSlots.filter((id): id is string => typeof id === 'string')
      : undefined;

    const normalized: RevisionRequest = {
      instruction,
      scope,
    };

    if (targetDesignId) {
      normalized.targetDesignId = targetDesignId;
    }
    if (targetOutputs?.length) {
      normalized.targetOutputs = targetOutputs;
    }
    if (targetSlots?.length) {
      normalized.targetSlots = targetSlots;
    }

    return normalized;
  }
}
