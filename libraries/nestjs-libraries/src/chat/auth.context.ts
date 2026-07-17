import {
  getAuth,
  getAccess,
  getUserId,
} from '@gitroom/nestjs-libraries/chat/async.storage';

export const checkAuth = (
  inputData: any,
  context: any
) => {
  const auth = getAuth();
  // The MCP SDK forwards `req.auth` verbatim as `authInfo`. The raw MCP
  // entrypoints store a wrapper `{ org, userId, role }` there, so unwrap to the
  // bare org before it is stringified as 'organization'. A bare org (the
  // copilot/ALS path) passes through unchanged.
  const raw = context?.mcp?.extra?.authInfo || auth;
  const authInfo = (raw as any)?.org ?? raw;
  if (authInfo && context?.requestContext) {
    (context.requestContext as any).set(
      'organization',
      JSON.stringify(authInfo)
    );
    (context.requestContext as any).set('ui', 'false');
    // Bridge the resolved user id (from the MCP/A2A auth layer) into the tool
    // context so write/ownership tools can resolve the acting user. Only the
    // copilot path sets 'user' itself; without this, parseUser() throws over
    // MCP/A2A. Never overwrite a 'user' the caller already provided.
    const userId = getUserId();
    if (userId && !(context.requestContext as any).get('user')) {
      (context.requestContext as any).set('user', JSON.stringify({ id: userId }));
    }
    const access = getAccess() ?? { mode: 'headless' };
    (context.requestContext as any).set('access', JSON.stringify(access));
  }
};
