import type {
  ChangePostStatusDto,
  CreatePostDto,
  GetNotificationsDto,
  GetPostsDto,
  TriggerIntegrationToolDto,
  UpdateReleaseIdDto,
  UploadDto,
  VideoDto,
  VideoFunctionDto,
  VideoJobResponse,
} from './types';
export type { VideoJobResponse } from './types';

function toQueryString(obj: Record<string, unknown>): string {
  const params = new URLSearchParams();
  Object.entries(obj).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      params.append(key, String(value));
    }
  });
  return params.toString();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default class Postmill {
  constructor(
    private _apiKey: string,
    private _path = 'https://api.postmill.ai'
  ) {}

  private _request(
    method: string,
    path: string,
    options: { body?: unknown; query?: Record<string, unknown>; form?: FormData } = {}
  ): Promise<unknown> {
    const queryString = options.query ? `?${toQueryString(options.query)}` : '';
    const url = `${this._path}/public/v1${path}${queryString}`;

    const init: RequestInit = {
      method,
      headers: {
        Authorization: this._apiKey,
      } as Record<string, string>,
    };

    if (options.form) {
      init.body = options.form;
      // FormData sets its own Content-Type with boundary.
    } else if (options.body) {
      (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }

    return fetch(url, init).then((res) => res.json());
  }

  async post(posts: CreatePostDto): Promise<unknown> {
    return this._request('POST', '/posts', { body: posts });
  }

  async postList(filters: GetPostsDto): Promise<unknown> {
    return this._request('GET', '/posts', { query: { ...filters } });
  }

  async upload(file: BlobPart | Buffer, extension: string): Promise<unknown> {
    const formData = new FormData();
    const type =
      extension === 'png'
        ? 'image/png'
        : extension === 'jpg' || extension === 'jpeg'
        ? 'image/jpeg'
        : extension === 'gif'
        ? 'image/gif'
        : 'image/jpeg';

    // Node Buffer → browser Blob; cast through unknown because Node's Buffer
    // generic uses ArrayBufferLike while DOM types expect ArrayBuffer.
    const blob = new Blob([file as unknown as BlobPart], { type });
    formData.append('file', blob, extension);

    return fetch(`${this._path}/public/v1/upload`, {
      method: 'POST',
      // @ts-ignore
      body: formData,
      headers: {
        Authorization: this._apiKey,
      },
    }).then((res) => res.json());
  }

  async uploadFromUrl(url: string): Promise<unknown> {
    return this._request('POST', '/upload-from-url', { body: { url } });
  }

  async findSlot(integrationId?: string): Promise<unknown> {
    return this._request('GET', `/find-slot/${integrationId ?? ''}`);
  }

  async deletePostGroup(group: string): Promise<unknown> {
    return this._request('DELETE', `/posts/group/${group}`);
  }

  async isConnected(): Promise<unknown> {
    return this._request('GET', '/is-connected');
  }

  async groups(): Promise<unknown> {
    return this._request('GET', '/groups');
  }

  async integrations(group?: string): Promise<unknown> {
    return this._request('GET', '/integrations', group ? { query: { group } } : undefined);
  }

  async connectChannel(
    integration: string,
    opts?: { refresh?: string; version?: string }
  ): Promise<unknown> {
    return this._request('GET', `/social/${integration}`, { query: { ...opts } });
  }

  async notifications(page?: number): Promise<unknown> {
    return this._request('GET', '/notifications', { query: page !== undefined ? { page } : {} });
  }

  async generateVideo(body: VideoDto): Promise<VideoJobResponse> {
    return this._request('POST', '/generate-video', { body }) as Promise<VideoJobResponse>;
  }

  async getVideoJob(id: string): Promise<VideoJobResponse> {
    return this._request('GET', `/generate-video/${id}`) as Promise<VideoJobResponse>;
  }

  async loadVoices(identifier: string): Promise<unknown> {
    return this._request('POST', '/video/function', {
      body: { identifier, functionName: 'loadVoices' } as VideoFunctionDto,
    });
  }

  async deleteChannel(id: string): Promise<unknown> {
    return this._request('DELETE', `/integrations/${id}`);
  }

  async integrationSettings(id: string): Promise<unknown> {
    return this._request('GET', `/integration-settings/${id}`);
  }

  async postMissingContent(id: string): Promise<unknown> {
    return this._request('GET', `/posts/${id}/missing`);
  }

  async changePostStatus(id: string, status: ChangePostStatusDto): Promise<unknown> {
    return this._request('PUT', `/posts/${id}/status`, { body: status });
  }

  async updateReleaseId(id: string, releaseId: UpdateReleaseIdDto): Promise<unknown> {
    return this._request('PUT', `/posts/${id}/release-id`, { body: releaseId });
  }

  async analyticsOverview(query: {
    from: string;
    to: string;
    integrations?: string[];
    compare?: boolean;
  }): Promise<unknown> {
    return this._request('GET', '/analytics/overview', {
      query: {
        from: query.from,
        to: query.to,
        integrations: query.integrations?.join(','),
        compare: query.compare,
      },
    });
  }

  async campaignAnalytics(
    id: string,
    query?: { from?: string; to?: string }
  ): Promise<unknown> {
    return this._request('GET', `/analytics/campaign/${id}`, { query: { ...query } });
  }

  async anomalies(query?: { limit?: number; includeDismissed?: boolean }): Promise<unknown> {
    return this._request('GET', '/analytics/anomalies', { query: { ...query } });
  }

  async channelAnalytics(integration: string, date: string): Promise<unknown> {
    return this._request('GET', `/analytics/${integration}`, { query: { date } });
  }

  async postAnalytics(postId: string, date: string): Promise<unknown> {
    return this._request('GET', `/analytics/post/${postId}`, { query: { date } });
  }

  async triggerIntegrationTool(
    id: string,
    body: TriggerIntegrationToolDto
  ): Promise<unknown> {
    return this._request('POST', `/integration-trigger/${id}`, { body });
  }

  async generateVideoAndWait(
    body: VideoDto,
    { pollIntervalMs = 3000, timeoutMs = 300000 }: { pollIntervalMs?: number; timeoutMs?: number } = {}
  ): Promise<VideoJobResponse> {
    const started = await this.generateVideo(body);
    if (!started.pollUrl) {
      return started;
    }

    const jobId = started.jobId || started.id;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const job = await this.getVideoJob(jobId);
      if (job.status === 'completed' || job.status === 'failed' || !job.pollUrl) {
        return job;
      }
      await delay(pollIntervalMs);
    }

    return {
      ...started,
      status: 'failed',
      error: 'Polling timed out waiting for video generation to complete',
    };
  }

  deletePost(id: string): Promise<Response> {
    return fetch(`${this._path}/public/v1/posts/${id}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: this._apiKey,
      },
    });
  }
}
