'use client';

import { useState, useCallback } from 'react';
import { useUser } from '../layout/user.context';
import copy from 'copy-to-clipboard';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { DeveloperComponent } from '@gitroom/frontend/components/developer/developer.component';
import { ApiKeysSection, CreatedKey } from '@gitroom/frontend/components/api-keys/api-keys.component';
import clsx from 'clsx';

const mcpClients = [
  'Claude Code',
  'Cursor',
  'VS Code / Copilot',
  'Windsurf',
  'Amp',
  'Codex',
  'Gemini CLI',
  'Warp',
] as const;

type McpClient = (typeof mcpClients)[number];

const getMcpConfig = (
  client: McpClient,
  method: 'header' | 'path',
  mcpBase: string,
  apiKey: string
): { config: string; hint: string; hintKey: string } => {
  const urlWithKey = `${mcpBase}/mcp/${apiKey}`;
  const urlBase = `${mcpBase}/mcp`;
  const bearer = `Bearer ${apiKey}`;

  const json = (obj: object) => JSON.stringify(obj, null, 2);

  if (method === 'path') {
    switch (client) {
      case 'Claude Code':
        return {
          config: `claude mcp add postmill --transport http "${urlWithKey}"`,
          hint: 'Run this command in your terminal.',
          hintKey: 'run_in_terminal',
        };
      case 'Cursor':
        return {
          config: json({ mcpServers: { postmill: { url: urlWithKey } } }),
          hint: 'Add to .cursor/mcp.json in your project root.',
          hintKey: 'add_to_cursor_mcp_json',
        };
      case 'VS Code / Copilot':
        return {
          config: json({
            servers: { postmill: { type: 'http', url: urlWithKey } },
          }),
          hint: 'Add to .vscode/mcp.json in your project root.',
          hintKey: 'add_to_vscode_mcp_json',
        };
      case 'Windsurf':
        return {
          config: json({
            mcpServers: { postmill: { serverUrl: urlWithKey } },
          }),
          hint: 'Add to ~/.codeium/windsurf/mcp_config.json',
          hintKey: 'add_to_windsurf_mcp_config',
        };
      case 'Amp':
        return {
          config: `amp mcp add postmill ${urlWithKey}`,
          hint: 'Run this command in your terminal.',
          hintKey: 'run_in_terminal',
        };
      case 'Codex':
        return {
          config: `# ~/.codex/config.toml\n\n[mcp_servers.postmill]\nurl = "${urlWithKey}"`,
          hint: 'Add to ~/.codex/config.toml',
          hintKey: 'add_to_codex_config_toml',
        };
      case 'Gemini CLI':
        return {
          config: json({ mcpServers: { postmill: { url: urlWithKey } } }),
          hint: 'Add to ~/.gemini/settings.json',
          hintKey: 'add_to_gemini_settings',
        };
      case 'Warp':
        return {
          config: json({ postmill: { url: urlWithKey } }),
          hint: 'Settings > MCP Servers > + Add, then paste this config.',
          hintKey: 'warp_mcp_settings_hint',
        };
    }
  }

  switch (client) {
    case 'Claude Code':
      return {
        config: `claude mcp add --transport http postmill ${urlBase} --header "Authorization: ${bearer}"`,
        hint: 'Run this command in your terminal.',
        hintKey: 'run_in_terminal',
      };
    case 'Cursor':
      return {
        config: json({
          mcpServers: {
            postmill: { url: urlBase, headers: { Authorization: bearer } },
          },
        }),
        hint: 'Add to .cursor/mcp.json in your project root.',
        hintKey: 'add_to_cursor_mcp_json',
      };
    case 'VS Code / Copilot':
      return {
        config: json({
          servers: {
            postmill: {
              type: 'http',
              url: urlBase,
              headers: { Authorization: bearer },
            },
          },
        }),
        hint: 'Add to .vscode/mcp.json in your project root.',
        hintKey: 'add_to_vscode_mcp_json',
      };
    case 'Windsurf':
      return {
        config: json({
          mcpServers: {
            postmill: {
              serverUrl: urlBase,
              headers: { Authorization: bearer },
            },
          },
        }),
        hint: 'Add to ~/.codeium/windsurf/mcp_config.json',
        hintKey: 'add_to_windsurf_mcp_config',
      };
    case 'Amp':
      return {
        config: json({
          'amp.mcpServers': {
            postmill: { url: urlBase, headers: { Authorization: bearer } },
          },
        }),
        hint: 'Add to your Amp settings.json',
        hintKey: 'add_to_amp_settings',
      };
    case 'Codex':
      return {
        config: `# ~/.codex/config.toml\n\n[mcp_servers.postmill]\nurl = "${urlBase}"\nhttp_headers = { "Authorization" = "${bearer}" }`,
        hint: 'Add to ~/.codex/config.toml',
        hintKey: 'add_to_codex_config_toml',
      };
    case 'Gemini CLI':
      return {
        config: json({
          mcpServers: {
            postmill: { url: urlBase, headers: { Authorization: bearer } },
          },
        }),
        hint: 'Add to ~/.gemini/settings.json',
        hintKey: 'add_to_gemini_settings',
      };
    case 'Warp':
      return {
        config: json({
          postmill: { url: urlBase, headers: { Authorization: bearer } },
        }),
        hint: 'Settings > MCP Servers > + Add, then paste this config.',
        hintKey: 'warp_mcp_settings_hint',
      };
  }
};

const CopyButton = ({
  text,
  label,
}: {
  text: string;
  label: string;
}) => {
  const toaster = useToaster();
  const t = useT();
  return (
    <button
      type="button"
      onClick={() => {
        copy(text);
        toaster.show(t('label_copied_to_clipboard', '{{label}} copied to clipboard', { label }), 'success');
      }}
      className="cursor-pointer px-[16px] h-[36px] bg-btnSimple hover:bg-boxHover transition-colors rounded-[8px] text-[13px] font-[600] flex items-center gap-[6px]"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
        <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
      </svg>
      {label}
    </button>
  );
};

const McpSection = ({
  apiKey,
  mcpBase,
}: {
  apiKey: string;
  mcpBase: string;
}) => {
  const t = useT();
  const [activeClient, setActiveClient] = useState<McpClient>('Claude Code');
  const [method, setMethod] = useState<'header' | 'path'>('header');
  const [revealed, setRevealed] = useState(false);

  const { config, hint, hintKey } = getMcpConfig(
    activeClient,
    method,
    mcpBase,
    apiKey
  );

  const remoteUrl = `${mcpBase}/mcp/${apiKey}`;
  const cliUrl = `${mcpBase}/mcp`;

  const maskedConfig = revealed
    ? config
    : config.replace(new RegExp(apiKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '*'.repeat(apiKey.length));

  const maskedRemoteUrl = revealed
    ? remoteUrl
    : remoteUrl.replace(apiKey, '*'.repeat(apiKey.length));

  if (!apiKey) {
    return (
      <div className="bg-newBgColorInnerInner rounded-[12px] border border-newBorder overflow-hidden">
        <div className="bg-newBgColorInner px-[20px] py-[14px] border-b border-newBorder">
          <div className="text-[15px] font-[600]">
            {t('mcp_client_configuration', 'MCP Client Configuration')}
          </div>
        </div>
        <div className="p-[20px]">
          <div className="text-[13px] text-newTableText">
            {t('mcp_no_key', 'Create an API key above to see MCP configuration.')}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-newBgColorInnerInner rounded-[12px] border border-newBorder overflow-hidden">
      <div className="bg-newBgColorInner px-[20px] py-[14px] border-b border-newBorder flex items-start justify-between gap-[12px]">
        <div>
          <div className="text-[15px] font-[600]">
            {t('mcp_client_configuration', 'MCP Client Configuration')}
          </div>
          <div className="text-[13px] text-newTableText mt-[2px]">
            {t(
              'connect_your_mcp_client_to_postiz_to_schedule_your_posts_faster',
              'Connect Postmill MCP server to your client (Http streaming) to schedule your posts faster!'
            )}
          </div>
        </div>
        <div className="flex gap-[6px] shrink-0 pt-[2px]">
          <a
            className="cursor-pointer px-[16px] h-[36px] bg-btnPrimary hover:bg-[#5520CB] text-white transition-colors rounded-[8px] text-[13px] font-[600] flex items-center gap-[6px]"
            href="https://docs.postmill.com/mcp/introduction"
            target="_blank"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
            {t('read_the_docs', 'Docs')}
          </a>
        </div>
      </div>
      <div className="p-[20px] flex flex-col gap-[16px]">
        <div className="flex flex-col gap-[6px]">
          <div className="text-[13px] font-[600] text-newTableText">
            {t('auth_method', 'Authentication')}
          </div>
          <div className="flex gap-[6px]">
            {(['header', 'path'] as const).map((m) => (
              <button
                key={m}
                type="button"
                className={clsx(
                  'cursor-pointer px-[14px] h-[36px] text-[13px] font-[500] rounded-[8px] transition-colors',
                  method === m
                    ? 'bg-btnPrimary text-white'
                    : 'bg-btnSimple text-newTableText hover:bg-boxHover hover:text-textColor'
                )}
                onClick={() => setMethod(m)}
              >
                {m === 'header'
                  ? t('cli_claude_code_codex', 'CLI (Claude Code / Codex)')
                  : t('remote_servers', 'Remote servers (ChatGPT, Claude)')}
              </button>
            ))}
          </div>
        </div>
        {method === 'header' && (
          <div className="flex flex-col gap-[6px]">
            <div className="text-[13px] font-[600] text-newTableText">
              {t('mcp_client', 'Client')}
            </div>
            <div className="flex flex-wrap gap-[6px]">
              {mcpClients.map((client) => (
                <button
                  key={client}
                  type="button"
                  className={clsx(
                    'cursor-pointer px-[14px] h-[36px] text-[13px] font-[500] rounded-[8px] transition-colors',
                    activeClient === client
                      ? 'bg-btnPrimary text-white'
                      : 'bg-btnSimple text-newTableText hover:bg-boxHover hover:text-textColor'
                  )}
                  onClick={() => setActiveClient(client)}
                >
                  {client}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="flex flex-col gap-[8px]">
          <div className="text-[12px] text-newTableText font-[500]">
            {method === 'header'
              ? t(hintKey, hint)
              : t(
                  'remote_server_url_hint',
                  'Paste this URL into your remote MCP client (ChatGPT, Claude, etc.).'
                )}
          </div>
          <pre className="bg-newBgColorInner border border-newBorder rounded-[8px] p-[16px] text-[13px] whitespace-pre-wrap break-all overflow-x-auto leading-[1.6]">
            {method === 'header' ? maskedConfig : maskedRemoteUrl}
          </pre>
          <div className="flex gap-[8px]">
            <button
              type="button"
              onClick={() => setRevealed(!revealed)}
              className="cursor-pointer px-[16px] h-[36px] bg-btnSimple hover:bg-boxHover transition-colors rounded-[8px] text-[13px] font-[600] flex items-center gap-[6px]"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {revealed ? (
                  <>
                    <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
                    <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </>
                ) : (
                  <>
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </>
                )}
              </svg>
              {revealed ? t('hide', 'Hide') : t('reveal', 'Reveal')}
            </button>
            <CopyButton
              text={method === 'header' ? config : remoteUrl}
              label={t('copy', 'Copy')}
            />
            {method === 'header' && (
              <CopyButton
                text={cliUrl}
                label={t('copy_url', 'Copy URL')}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const localCliSteps = [
  {
    labelKey: 'cli_step_install_cli',
    label: 'Install the CLI',
    code: 'npm install -g postmill',
  },
  {
    labelKey: 'cli_step_run_auth_login',
    label: 'Run: postmill auth:login',
    code: 'postmill auth:login',
  },
  {
    labelKey: 'cli_step_install_skill',
    label: 'Install the Postmill skill for your AI agent',
    code: 'npx skills add @postmill-ai/postmill-agent',
  },
] as const;

const ciCliSteps = [
  {
    labelKey: 'cli_step_install_cli',
    label: 'Install the CLI',
    code: 'npm install -g postmill',
  },
  {
    labelKey: 'cli_step_set_env_var',
    label: 'Set your API key as an environment variable',
    code: 'export POSTMILL_API_KEY="{API_KEY}"',
  },
  {
    labelKey: 'cli_step_install_skill',
    label: 'Install the Postmill skill for your AI agent',
    code: 'npx skills add @postmill-ai/postmill-agent',
  },
] as const;

const CliSection = ({ apiKey }: { apiKey: string }) => {
  const t = useT();
  const [mode, setMode] = useState<'local' | 'ci'>('local');
  const [revealed, setRevealed] = useState(false);

  const steps =
    mode === 'local'
      ? localCliSteps.map((step) => ({ ...step }))
      : ciCliSteps.map((step) => ({
          ...step,
          code: step.code.replace('{API_KEY}', apiKey),
        }));

  const displaySteps =
    mode === 'ci' && !revealed
      ? steps.map((step) => ({
          ...step,
          code: step.code.replace(
            new RegExp(apiKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
            '*'.repeat(apiKey.length)
          ),
        }))
      : steps;

  if (!apiKey) {
    return (
      <div className="bg-newBgColorInnerInner rounded-[12px] border border-newBorder overflow-hidden">
        <div className="bg-newBgColorInner px-[20px] py-[14px] border-b border-newBorder">
          <div className="text-[15px] font-[600]">
            {t('cli_and_skills', 'CLI & AI Skills')}
          </div>
        </div>
        <div className="p-[20px]">
          <div className="text-[13px] text-newTableText">
            {t('cli_no_key', 'Create an API key above to use the CLI.')}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-newBgColorInnerInner rounded-[12px] border border-newBorder overflow-hidden">
      <div className="bg-newBgColorInner px-[20px] py-[14px] border-b border-newBorder flex items-start justify-between gap-[12px]">
        <div>
          <div className="text-[15px] font-[600]">
            {t('cli_and_skills', 'CLI & AI Skills')}
          </div>
          <div className="text-[13px] text-newTableText mt-[2px]">
            {t(
              'cli_description',
              'Use the Postmill CLI to automate posting from your terminal, or install the skill to let your AI agent schedule posts for you.'
            )}
          </div>
        </div>
        <div className="flex gap-[6px] shrink-0 pt-[2px]">
          <a
            className="cursor-pointer px-[16px] h-[36px] bg-btnPrimary hover:bg-[#5520CB] text-white transition-colors rounded-[8px] text-[13px] font-[600] flex items-center gap-[6px]"
            href="https://docs.postmill.com/cli/introduction"
            target="_blank"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
            {t('read_the_docs', 'Docs')}
          </a>
        </div>
      </div>
      <div className="p-[20px] flex flex-col gap-[16px]">
        <div className="flex gap-[6px]">
          {(['local', 'ci'] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={clsx(
                'cursor-pointer px-[14px] h-[36px] text-[13px] font-[500] rounded-[8px] transition-colors',
                mode === m
                  ? 'bg-btnPrimary text-white'
                  : 'bg-btnSimple text-newTableText hover:bg-boxHover hover:text-textColor'
              )}
              onClick={() => setMode(m)}
            >
              {m === 'local'
                ? t('locally', 'Locally')
                : t('ci_remote_servers', 'CI / Remote servers')}
            </button>
          ))}
        </div>
        {displaySteps.map((step, i) => (
          <div key={step.label} className="flex flex-col gap-[6px]">
            <div className="text-[13px] font-[600] text-newTableText">
              {i + 1}. {t(step.labelKey, step.label)}
            </div>
            <pre className="bg-newBgColorInner border border-newBorder rounded-[8px] p-[16px] text-[13px] whitespace-pre-wrap break-all overflow-x-auto leading-[1.6]">
              {step.code}
            </pre>
          </div>
        ))}
        <div className="flex gap-[8px]">
          {mode === 'ci' && (
            <button
              type="button"
              onClick={() => setRevealed(!revealed)}
              className="cursor-pointer px-[16px] h-[36px] bg-btnSimple hover:bg-boxHover transition-colors rounded-[8px] text-[13px] font-[600] flex items-center gap-[6px]"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {revealed ? (
                  <>
                    <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
                    <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </>
                ) : (
                  <>
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </>
                )}
              </svg>
              {revealed ? t('hide', 'Hide') : t('reveal', 'Reveal')}
            </button>
          )}
          <CopyButton
            text={steps.map((s) => s.code).join(' && ')}
            label={t('copy_all', 'Copy All')}
          />
        </div>
      </div>
    </div>
  );
};

const PublicApiContent = () => {
  const user = useUser();
  const { backendUrl, mcpUrl } = useVariables();
  const t = useT();
  const [lastCreatedKey, setLastCreatedKey] = useState('');

  const mcpBase = mcpUrl || backendUrl;

  return (
    <div className="flex flex-col gap-[40px]">
      <div className="text-[14px] text-textColor leading-[1.7]">
        {t(
          'api_auth_note_line1',
          'Use your API Key to automate your own account.'
        )}
        <br />
        {t(
          'api_auth_note_line2',
          'If you are building a product that schedules posts on behalf of other Postmill users,'
        )}
        <br />
        {t(
          'api_auth_note_line3',
          'create an OAuth App under the "Apps" tab. Your users will authorize your app via OAuth2,'
        )}
        <br />
        {t(
          'api_auth_note_line4',
          'and you will receive a pos_ prefixed token that works with the API, MCP, and CLI — just like an API Key.'
        )}
      </div>

      <ApiKeysSection
        onKeyCreated={(key: CreatedKey) => setLastCreatedKey(key.plaintext)}
      />

      <McpSection apiKey={lastCreatedKey} mcpBase={mcpBase} />

      <CliSection apiKey={lastCreatedKey} />
    </div>
  );
};

export const PublicComponent = () => {
  const t = useT();
  const [subTab, setSubTab] = useState<'api' | 'developer'>('api');

  return (
    <div className="flex flex-col gap-[20px]">
      <div className="flex gap-[6px]">
        {(['api', 'developer'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            className={clsx(
              'cursor-pointer px-[20px] h-[44px] text-[15px] font-[600] rounded-[8px] transition-colors',
              subTab === tab
                ? 'bg-btnPrimary text-white'
                : 'bg-btnSimple text-newTableText hover:bg-boxHover hover:text-textColor'
            )}
            onClick={() => setSubTab(tab)}
          >
            {tab === 'api'
              ? t('access', 'Access')
              : t('apps', 'Apps')}
          </button>
        ))}
      </div>
      {subTab === 'api' && (
        <div className="flex flex-col gap-[16px]">
          <div className="flex flex-col gap-[4px]">
            <h3 className="text-[18px] font-semibold text-textColor">
              {t('access', 'Access')}
            </h3>
            <p className="text-[13px] text-newTableText">
              {t(
                'access_description',
                'Create and manage API keys to connect Postmill to your own tools and scripts.'
              )}
            </p>
          </div>
          <PublicApiContent />
        </div>
      )}
      {subTab === 'developer' && (
        <div className="flex flex-col gap-[16px]">
          <div className="flex flex-col gap-[4px]">
            <h3 className="text-[18px] font-semibold text-textColor">
              {t('apps', 'Apps')}
            </h3>
            <p className="text-[13px] text-newTableText">
              {t(
                'apps_description',
                'Register developer apps and MCP clients that can connect to Postmill on your behalf.'
              )}
            </p>
          </div>
          <DeveloperComponent />
        </div>
      )}
    </div>
  );
};
