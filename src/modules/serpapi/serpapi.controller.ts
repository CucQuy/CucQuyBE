import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SsoAuthGuard } from '../../auth/sso-auth.guard';
import { SerpapiService } from './serpapi.service';

@ApiTags('SerpApi (bản đồ/ship)')
@Controller('serpapi')
@UseGuards(SsoAuthGuard)
export class SerpapiController {
  constructor(private readonly service: SerpapiService) {}

  /** Google Maps search/place. Tham số: q, ll, type, hl, start. */
  @Get('maps')
  searchMaps(
    @Query('q') q?: string,
    @Query('ll') ll?: string,
    @Query('type') type?: string,
    @Query('hl') hl?: string,
    @Query('start') start?: string,
  ) {
    return this.service.searchMaps({
      q,
      ll,
      type,
      hl,
      start: start != null && start !== '' ? Number(start) : undefined,
    });
  }

  /** Google Maps directions. Tham số: startAddr, endAddr, startCoords, endCoords, travelMode, distanceUnit, hl. */
  @Get('directions')
  getDirections(
    @Query('startAddr') startAddr?: string,
    @Query('endAddr') endAddr?: string,
    @Query('startCoords') startCoords?: string,
    @Query('endCoords') endCoords?: string,
    @Query('travelMode') travelMode?: string,
    @Query('distanceUnit') distanceUnit?: string,
    @Query('hl') hl?: string,
  ) {
    return this.service.getDirections({
      startAddr,
      endAddr,
      startCoords,
      endCoords,
      travelMode:
        travelMode != null && travelMode !== '' ? Number(travelMode) : undefined,
      distanceUnit:
        distanceUnit != null && distanceUnit !== ''
          ? Number(distanceUnit)
          : undefined,
      hl,
    });
  }
}
