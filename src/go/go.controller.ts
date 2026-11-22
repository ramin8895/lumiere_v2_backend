import { Controller, Get, Param, ParseIntPipe, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { GoService } from './go.service';

/** Only trust X-Real-IP / X-Forwarded-For when the caller is on loopback (lumiere-web / nginx on the same host). */
export function clientIp(req: Request): string {
  const remote = req.socket.remoteAddress ?? '';
  const local = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  if (local) {
    const fwd = (req.headers['x-real-ip'] as string) || (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim();
    if (fwd) return fwd;
  }
  return remote;
}

@Controller('go')
export class GoController {
  constructor(private readonly go: GoService) {}

  @Get(':listingId')
  async redirect(
    @Param('listingId', ParseIntPipe) listingId: number,
    @Query('variant') variant: string | undefined,
    @Query('ref') ref: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const target = await this.go.resolve(listingId, {
      variant: typeof variant === 'string' ? variant.slice(0, 64) : undefined,
      ref: typeof ref === 'string' ? ref : undefined,
      ip: clientIp(req),
      ua: String(req.headers['user-agent'] ?? ''),
    });
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.redirect(302, target);
  }
}
