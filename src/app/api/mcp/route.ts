import { createMcpHandler, withMcpAuth } from 'mcp-handler';
import { registerBookingTools } from '@/lib/mcp/register-tools';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const handler = createMcpHandler(
  (server) => {
    registerBookingTools(server);
  },
  {
    serverInfo: { name: 'omgexp-booking', version: '1.0.0' },
    verboseLogs: process.env.NODE_ENV !== 'production',
  }
);

function verifyToken(_req: Request, bearerToken?: string) {
  const expected = process.env.MCP_API_TOKEN;
  if (!expected || !bearerToken || bearerToken !== expected) return undefined;
  return {
    token: bearerToken,
    clientId: 'omgexp-mcp',
    scopes: ['booking:read', 'booking:draft', 'tracking:write'],
  };
}

const authHandler = withMcpAuth(handler, verifyToken, { required: true });

export { authHandler as GET, authHandler as POST, authHandler as DELETE };
