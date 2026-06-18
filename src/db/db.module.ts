import { Global, Module } from '@nestjs/common';
import { DbService } from './db.service';

/** Global → mọi module inject DbService không cần import lại (giống FirebaseModule). */
@Global()
@Module({
  providers: [DbService],
  exports: [DbService],
})
export class DbModule {}
