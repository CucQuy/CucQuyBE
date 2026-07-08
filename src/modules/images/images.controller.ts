import {
  Body,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { SsoAuthGuard } from '../../auth/sso-auth.guard';
import { ImagesService } from './images.service';

@ApiTags('Ảnh')
@Controller('images')
@UseGuards(SsoAuthGuard)
export class ImagesController {
  constructor(private readonly service: ImagesService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @UploadedFile()
    file: { buffer: Buffer; originalname: string; mimetype: string },
    @Body('path') path: string,
  ): Promise<{ url: string }> {
    const url = await this.service.upload(file, path);
    return { url };
  }

  @Post('delete')
  async remove(@Body('url') url: string): Promise<{ ok: true }> {
    await this.service.remove(url);
    return { ok: true };
  }
}
