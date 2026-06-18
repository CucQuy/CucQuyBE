import { Injectable } from '@nestjs/common';
import { CustomerProc, CustomerRow } from './customers.proc';

/** Khách hàng — khớp cột bảng customers (id, name, phone, created_at). */
export interface Customer {
  id: string;
  name: string;
  phone?: string;
  createdAt?: string;
}

const mapRow = (r: CustomerRow): Customer => ({
  id: r.id,
  name: r.name,
  phone: r.phone ?? undefined,
  createdAt:
    r.created_at == null
      ? undefined
      : r.created_at instanceof Date
        ? r.created_at.toISOString()
        : String(r.created_at),
});

/** Toàn bộ logic ở stored function app.customer_* — service chỉ orchestration + map. */
@Injectable()
export class CustomersService {
  constructor(private readonly proc: CustomerProc) {}

  async fetchCustomers(): Promise<Customer[]> {
    return (await this.proc.list()).map(mapRow);
  }

  async addCustomer(data: Omit<Customer, 'id'>): Promise<{ id: string }> {
    const rows = await this.proc.create(data ?? {});
    return { id: rows[0]?.id };
  }

  async updateCustomer(
    id: string,
    data: Partial<Omit<Customer, 'id'>>,
  ): Promise<void> {
    const { id: _ignored, ...updateData } = data as Record<string, unknown>;
    await this.proc.update(id, updateData ?? {});
  }

  async deleteCustomer(id: string): Promise<void> {
    await this.proc.delete(id);
  }
}
