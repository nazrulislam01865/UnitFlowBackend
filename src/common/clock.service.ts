import { Injectable } from '@nestjs/common';
@Injectable()
export class Clock {
  date(): Date {
    return new Date();
  }
  get now(): string {
    return this.date().toISOString();
  }
  get today(): string {
    return new Date(this.date().getTime() + 6 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }
  get cycle(): string {
    return this.today.slice(0, 7);
  }
}
