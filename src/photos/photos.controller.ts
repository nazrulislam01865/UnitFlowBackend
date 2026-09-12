import { Controller, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { CurrentAccess } from '../auth/auth.decorators';
import { Access } from '../auth/access';
import { HouseGuard } from '../auth/house.guard';
import { PhotosService } from './photos.service';
import { Request, Response } from 'express';
@Controller('v1')
@UseGuards(HouseGuard)
export class PhotosController {
  constructor(private readonly service: PhotosService) {}
  @Post('units/:id/photos')
  upload(@CurrentAccess() a: Access, @Param('id') id: string, @Req() req: Request) {
    return this.service.upload(
      a,
      id,
      Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
      req.headers['content-type'] ?? '',
    );
  }
  @Get('photos/:id')
  async download(@CurrentAccess() a: Access, @Param('id') id: string, @Res() res: Response) {
    const result = await this.service.download(a, id);
    res.status(200).setHeader('Content-Type', result.contentType);
    res.end(result.bytes);
  }
}
