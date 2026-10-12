import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

export type Role = 'student' | 'admin';

export interface AuthenticatedRequest extends Express.Request {
  user?: {
    id: string;
    email: string;
    role: Role;
    fullName: string;
    [key: string]: any;
  };
}

const SECRET = process.env.JWT_SECRET || 'development-secret-change-me';

function base64UrlEncode(value: string | Buffer): string {
  const input = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return input
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(value: string): string {
  const padding = value.length % 4 === 0 ? '' : '='.repeat(4 - (value.length % 4));
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized + padding, 'base64').toString('utf8');
}

function sign(input: string): string {
  return createHmac('sha256', SECRET).update(input).digest('base64url');
}

export function generateToken(user: Record<string, any>): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    fullName: user.fullName,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = sign(`${encodedHeader}.${encodedPayload}`);
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

export function verifyToken(token: string) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, signature] = parts;
  const signingInput = `${headerB64}.${payloadB64}`;
  const expected = sign(signingInput);

  const actual = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);

  if (actual.length !== expectedBuf.length) return null;

  try {
    if (!timingSafeEqual(actual, expectedBuf)) return null;
  } catch {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(payloadB64));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function authenticateToken(req: AuthenticatedRequest, res: any, next: any) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication token is required.' });
  }

  const token = header.slice('Bearer '.length).trim();
  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }

  req.user = {
    id: payload.sub,
    email: payload.email,
    role: payload.role,
    fullName: payload.fullName,
  };
  return next();
}

export function optionalAuth(req: AuthenticatedRequest, res: any, next: any) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return next();
  }

  const token = header.slice('Bearer '.length).trim();
  const payload = verifyToken(token);
  if (payload) {
    req.user = {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      fullName: payload.fullName,
    };
  }

  return next();
}

export function requireAdmin(req: AuthenticatedRequest, res: any, next: any) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Administrative access required.' });
  }
  return next();
}

export function requireStudent(req: AuthenticatedRequest, res: any, next: any) {
  if (!req.user || req.user.role !== 'student') {
    return res.status(403).json({ error: 'Student access required.' });
  }
  return next();
}
