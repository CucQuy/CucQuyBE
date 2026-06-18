import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { UserProc } from './users.proc';

@Module({
  controllers: [UsersController],
  providers: [UsersService, UserProc],
})
export class UsersModule {}
