import { Injectable } from '@nestjs/common';
import { CarrierProc, Carrier } from './carriers.proc';

/** Đơn vị vận chuyển (danh bạ) — orchestration mỏng. */
@Injectable()
export class CarriersService {
  constructor(private readonly proc: CarrierProc) {}

  async list(): Promise<Carrier[]> {
    const [row] = await this.proc.list();
    return row?.data ?? [];
  }

  async save(p: unknown): Promise<Carrier[]> {
    const [row] = await this.proc.save(p);
    return row?.data ?? [];
  }

  async remove(id: string): Promise<Carrier[]> {
    const [row] = await this.proc.delete(id);
    return row?.data ?? [];
  }
}
