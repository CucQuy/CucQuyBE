export interface Asset {
  id: string;
  name: string;
  cost: number;
  usefulMonths: number;
  startDate: string; // ISO yyyy-mm-dd
  category?: string | null;
  note?: string | null;
  createdAt: string;
}
