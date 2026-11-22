import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { verifyRequest } from './hmac';

/** Server-to-server auth for /api/sync/* and /api/admin/*: signature covers method + exact path + query. */
@Injectable()
export class HmacGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const ts = req.headers['x-lumiere-timestamp'];
    const sig = req.headers['x-lumiere-signature'];
    const ok = verifyRequest(this.cfg.secret, typeof ts === 'string' ? ts : undefined, typeof sig === 'string' ? sig : undefined, req.method, req.originalUrl);
    if (!ok) throw new UnauthorizedException('invalid signature');
    return true;
  }
}
