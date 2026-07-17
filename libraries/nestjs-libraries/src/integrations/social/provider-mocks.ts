export type ProviderMock = {
  tokenResponse: Record<string, any>;
  userResponse: Record<string, any>;
  postResponse: Record<string, any>;
  mediaResponse?: Record<string, any>;
};

function idObj(overrides: Record<string, any> = {}): Record<string, any> {
  return { id: '123', ...overrides };
}

function u(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    id: '123', name: 'Test User', username: 'testuser', display_name: 'Test User',
    email: 'test@example.com', picture: 'https://ex.com/pic.jpg', avatar: 'https://ex.com/av.jpg',
    ...overrides,
  };
}

const mocks: Record<string, ProviderMock> = {
  x: {
    tokenResponse: { accessToken: 'tok', accessSecret: 'sec' },
    userResponse: { data: { id: '123', name: 'Test User', username: 'testuser', profile_image_url: 'https://ex.com/pic.jpg' } },
    postResponse: { data: { id: 'post-123' } },
  },
  linkedin: {
    tokenResponse: { access_token: 'tok', refresh_token: 'rtok', expires_in: 7200 },
    userResponse: { sub: '123', name: 'Test User', picture: 'https://ex.com/pic.jpg' },
    postResponse: { id: 'post-123' },
  },
  'linkedin-page': {
    tokenResponse: { access_token: 'tok', refresh_token: 'rtok', expires_in: 7200 },
    userResponse: { sub: '123', name: 'Test User', picture: 'https://ex.com/pic.jpg' },
    postResponse: { id: 'post-123' },
  },
  reddit: {
    tokenResponse: { access_token: 'tok', refresh_token: 'rtok', expires_in: 7200 },
    userResponse: u({ icon_img: 'https://ex.com/icon.jpg' }),
    postResponse: { json: { data: { id: 'post-123', name: 'Test', url: 'https://reddit.com/r/test' } } },
  },
  facebook: {
    tokenResponse: { access_token: 'tok', expires_in: 7200 },
    userResponse: u(),
    postResponse: idObj({ permalink_url: 'https://fb.com/p/123' }),
    mediaResponse: idObj(),
  },
  instagram: {
    tokenResponse: { access_token: 'tok', expires_in: 7200 },
    userResponse: u(),
    postResponse: { id: 'media-123', permalink: 'https://ig.com/p/123' },
    mediaResponse: idObj(),
  },
  'instagram-standalone': {
    tokenResponse: { access_token: 'tok', expires_in: 7200 },
    userResponse: { user_id: '123', name: 'Test', username: 'testuser', profile_picture_url: 'https://ex.com/pic.jpg' },
    postResponse: { id: 'media-123', permalink: 'https://ig.com/p/123' },
    mediaResponse: idObj(),
  },
  threads: {
    tokenResponse: { access_token: 'tok', expires_in: 7200 },
    userResponse: { id: '123', username: 'testuser', threads_profile_picture_url: 'https://ex.com/pic.jpg' },
    postResponse: { id: 'thread-123', permalink: 'https://threads.net/p/123' },
    mediaResponse: idObj(),
  },
  youtube: {
    tokenResponse: { tokens: { access_token: 'tok', refresh_token: 'rtok', expiry_date: Date.now() + 3600000 } },
    userResponse: { data: { id: '123', name: 'Test User', picture: 'https://ex.com/pic.jpg' } },
    postResponse: { data: { id: 'video-123' } },
  },
  tiktok: {
    tokenResponse: { access_token: 'tok', refresh_token: 'rtok' },
    userResponse: { data: { user: { open_id: '123', display_name: 'Test', avatar_url: 'https://ex.com/av.jpg', username: 'testuser' } } },
    postResponse: { data: { publish_id: 'pub-123' } },
  },
  pinterest: {
    tokenResponse: { access_token: 'tok', refresh_token: 'rtok', expires_in: 7200 },
    userResponse: { id: '123', profile_image: 'https://ex.com/pic.jpg', username: 'testuser' },
    postResponse: { id: 'pin-123' },
    mediaResponse: { media_id: 'media-123', upload_url: 'https://upload.ex.com', upload_parameters: {} },
  },
  dribbble: {
    tokenResponse: { access_token: 'tok', expires_in: 7200 },
    userResponse: u({ profile_image: 'https://ex.com/pic.jpg', avatar_url: 'https://ex.com/av.jpg', login: 'testuser' }),
    postResponse: { id: 'shot-123' },
  },
  discord: {
    tokenResponse: { access_token: 'tok', expires_in: 7200, refresh_token: 'rtok' },
    userResponse: { application: { name: 'Discord App', bot: { id: '123', username: 'testbot', avatar: '' } } },
    postResponse: { id: 'msg-123' },
  },
  slack: {
    tokenResponse: { access_token: 'tok', team: { id: 't1', name: 'Test' }, bot_user_id: 'b1' },
    userResponse: { user: { real_name: 'Test User', name: 'testuser', profile: { image_original: 'https://ex.com/pic.jpg' } }, team: { id: 't1', name: 'Test' } },
    postResponse: { ts: '123', channel: 'C123', permalink: 'https://slack.com/archives/C123/p123' },
    mediaResponse: { id: 'file-123' },
  },
  mastodon: {
    tokenResponse: { access_token: 'tok' },
    userResponse: { id: '123', display_name: 'Test User', acct: 'testuser', avatar: 'https://ex.com/av.jpg', username: 'testuser' },
    postResponse: { id: 'post-123' },
    mediaResponse: { id: 'media-123' },
  },
  bluesky: {
    tokenResponse: { accessJwt: 'tok', refreshJwt: 'rtok' },
    userResponse: { did: 'did:plc:123', handle: 'testuser', displayName: 'Test User', avatar: 'https://ex.com/av.jpg' },
    postResponse: { uri: 'at://did:plc:123/app.bsky.feed.post/abc', cid: 'bafyabc123' },
    mediaResponse: { blob: { ref: { $link: 'bafkabc' }, mimeType: 'image/jpeg', size: 1000 } },
  },
  lemmy: {
    tokenResponse: { jwt: 'mock-jwt' },
    userResponse: { person_view: { person: { id: '123', display_name: 'Test User', name: 'testuser', avatar: 'https://ex.com/av.jpg' } } },
    postResponse: { post_view: { post: { id: 'post-123' } } },
  },
  gmb: {
    tokenResponse: { access_token: 'tok', expiry_date: Date.now() + 3600000, refresh_token: 'rtok' },
    userResponse: { data: u() },
    postResponse: { name: 'accounts/123/posts/post-123' },
  },
  vk: {
    tokenResponse: { access_token: 'tok', refresh_token: 'rtok', expires_in: 7200 },
    userResponse: { user: { user_id: '123', first_name: 'Test', last_name: 'User', avatar: 'https://ex.com/av.jpg' } },
    postResponse: { response: { post_id: '123' } },
    mediaResponse: { response: [{ id: 'photo-123' }] },
  },
  whop: {
    tokenResponse: { access_token: 'tok', refresh_token: 'rtok', expires_in: 7200 },
    userResponse: { sub: '123', name: 'Test User', preferred_username: 'testuser', picture: 'https://ex.com/pic.jpg' },
    postResponse: { data: { id: 'post-123' } },
    mediaResponse: { id: 'file-123', upload_url: 'https://upload.ex.com', upload_headers: {}, upload_status: 'ready' },
  },
  mewe: {
    tokenResponse: { apiToken: 'tok', expiresAt: Date.now() + 3600000, pending: false },
    userResponse: { userId: '123', name: 'Test User', firstName: 'Test', lastName: 'User', handle: 'testuser' },
    postResponse: { id: 'post-123' },
    mediaResponse: { id: 'media-123' },
  },
  kick: {
    tokenResponse: { access_token: 'tok', refresh_token: 'rtok', expires_in: 7200 },
    userResponse: { data: [{ user_id: '123', id: '123', name: 'Test', profile_picture: 'https://ex.com/pic.jpg' }] },
    postResponse: { data: { message_id: 'msg-123', is_sent: true } },
  },
  twitch: {
    tokenResponse: { access_token: 'tok', refresh_token: 'rtok', expires_in: 7200 },
    userResponse: { data: [{ id: '123', display_name: 'Test User', login: 'testuser', profile_image_url: 'https://ex.com/pic.jpg' }] },
    postResponse: { data: [{ message_id: 'msg-123', is_sent: true }] },
  },
  wrapcast: {
    tokenResponse: { signer_uuid: 'sig-123' },
    userResponse: { fid: 123, display_name: 'Test User', pfp_url: 'https://ex.com/pic.jpg', username: 'testuser' },
    postResponse: { cast: { hash: '0xabc', author: { username: 'testuser' } } },
  },
  telegram: {
    tokenResponse: { id: '123' },
    userResponse: { id: '123', username: 'testuser', title: 'Test Chat', photo: { big_file_id: 'fid123' } },
    postResponse: { message_id: 123 },
  },
  nostr: {
    tokenResponse: {},
    userResponse: { name: 'Test User', displayName: 'Test User', display_name: 'Test User', picture: 'https://ex.com/pic.jpg' },
    postResponse: { id: 'event-123' },
  },
  medium: {
    tokenResponse: { apiKey: 'key' },
    userResponse: { data: { id: '123', name: 'Test User', imageUrl: 'https://ex.com/pic.jpg', username: 'testuser' } },
    postResponse: { data: { id: 'post-123', url: 'https://medium.com/p/123' } },
  },
  devto: {
    tokenResponse: { apiKey: 'key' },
    userResponse: u({ profile_image: 'https://ex.com/pic.jpg' }),
    postResponse: { id: 'post-123', url: 'https://dev.to/t/test-123' },
  },
  hashnode: {
    tokenResponse: { apiKey: 'key' },
    userResponse: { data: { me: { id: '123', name: 'Test User', profilePicture: 'https://ex.com/pic.jpg', username: 'testuser' } } },
    postResponse: { data: { publishPost: { post: { id: 'post-123', url: 'https://hashnode.com/p/123' } } } },
  },
  wordpress: {
    tokenResponse: { domain: 'test.blog', username: 'admin', password: 'pass' },
    userResponse: u({ avatar_urls: { '96': 'https://ex.com/pic.jpg' } }),
    postResponse: { id: 'post-123', link: 'https://test.blog/p/123' },
    mediaResponse: { id: 'media-123' },
  },
  listmonk: {
    tokenResponse: { username: 'admin', password: 'pass' },
    userResponse: { data: { 'app.site_name': 'Test Listmonk', 'app.logo_url': 'https://ex.com/logo.png' } },
    postResponse: { data: { uuid: 'uuid-123', id: 'campaign-123' } },
  },
  skool: {
    tokenResponse: { auth_token: 'tok', client_id: 'c123' },
    userResponse: { id: '123', first_name: 'Test', last_name: 'User', metadata: { picture_profile: 'https://ex.com/pic.jpg' }, name: 'Test User' },
    postResponse: { id: 'post-123', name: 'Test Post' },
    mediaResponse: { write_url: 'https://upload.ex.com', content_type: 'image/jpeg', acl: 'public', file: { id: 'file-123' } },
  },
  moltbook: {
    tokenResponse: {},
    userResponse: { success: true, agent: { id: '123', name: 'Test Agent', display_name: 'Test Agent' } },
    postResponse: { success: true, post: { id: 'post-123' } },
  },
  tumblr: {
    tokenResponse: { access_token: 'tok', refresh_token: 'rtok', expires_in: 3600 },
    userResponse: { response: { user: { blogs: [{ name: 'testblog', title: 'Test Blog', avatar: [{ url: 'https://ex.com/av.jpg' }] }] } } },
    postResponse: { response: { id_string: 'post-123', id: 123 } },
  },
  pixelfed: {
    tokenResponse: { access_token: 'tok' },
    userResponse: { id: '123', display_name: 'Test User', username: 'testuser', avatar: 'https://ex.com/av.jpg' },
    postResponse: { id: 'post-123', url: 'https://pixelfed.social/p/testuser/123' },
    mediaResponse: { id: 'media-123' },
  },
  peertube: {
    tokenResponse: { access_token: 'tok', refresh_token: 'rtok' },
    userResponse: { id: '123', account: { displayName: 'Test User', avatar: { path: '/avatar.jpg' } }, username: 'testuser', videoChannels: [{ id: 1 }] },
    postResponse: { video: { id: 'vid-123', uuid: 'abc-123' } },
  },
};

export function getProviderMock(id: string): ProviderMock {
  return mocks[id] || {
    tokenResponse: { access_token: 'tok' },
    userResponse: { id: '123', name: 'Test' },
    postResponse: { id: 'post-123' },
  };
}
