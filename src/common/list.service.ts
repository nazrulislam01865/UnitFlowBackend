import { Injectable } from '@nestjs/common';
import { Store, QueryFilter } from '../firebase/store';
import { Access } from '../auth/access';
import { Clock } from './clock.service';
import { ListQueryDto } from './list-query.dto';
import { bad } from './errors/api-error';
import { identifier } from './validation/fields';
import { dateOnly } from '../billing/calculation';
@Injectable()
export class ListService {
  constructor(
    private readonly store: Store,
    private readonly clock: Clock,
  ) {}
  validate(query: ListQueryDto): number {
    const text = query.limit ?? '30';
    const limit = Number(text);
    if (!/^[+]?\d+$/.test(text) || !Number.isInteger(limit) || limit < 1 || limit > 50)
      bad('Limit must be between 1 and 50.');
    if (query.after !== undefined) identifier(query.after);
    return limit;
  }
  async list(
    a: Access,
    collection: 'units' | 'members' | 'bills' | 'activities',
    query: ListQueryDto = {},
  ) {
    const limit = this.validate(query);
    const filters: QueryFilter[] = [];
    let orderField: string | undefined;
    switch (collection) {
      case 'units':
        if (query.status === 'vacant') filters.push({ field: 'occupied', value: false });
        if (query.status === 'pending' || query.status === 'completed') {
          filters.push(
            { field: 'occupied', value: true },
            {
              field: 'lastCycle',
              value: this.clock.cycle,
              op: query.status === 'pending' ? '<' : '==',
            },
          );
          if (query.status === 'pending') orderField = 'lastCycle';
        }
        if (!a.staff) filters.push({ field: 'residentUid', value: a.identity.uid });
        break;
      case 'members':
        a.requireStaff();
        filters.push({ field: 'active', value: true });
        if (query.search?.trim())
          filters.push({
            field: 'searchTokens',
            value: query.search.trim().toLowerCase(),
            op: 'array-contains',
          });
        break;
      case 'bills':
        orderField = 'cycle';
        if (!a.staff) filters.push({ field: 'residentUid', value: a.identity.uid });
        if (query.unitId !== undefined)
          filters.push({ field: 'unitId', value: identifier(query.unitId) });
        if (query.cycle !== undefined) {
          dateOnly(`${query.cycle}-01`);
          filters.push({ field: 'cycle', value: query.cycle });
        }
        break;
      case 'activities':
        orderField = 'at';
        if (!a.staff) filters.push({ field: 'subjectUid', value: a.identity.uid });
        break;
    }
    const rows = await this.store.list<{ id: string }>(a.path(collection), {
      filters,
      limit: limit + 1,
      after: query.after,
      orderField,
      descending: collection === 'bills' || collection === 'activities',
    });
    const items = rows.slice(0, limit);
    return { items, nextCursor: rows.length > limit ? items.at(-1)!.id : null };
  }
}
