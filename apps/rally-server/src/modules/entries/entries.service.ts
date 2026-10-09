import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ApiErrorCode, Crew, TransponderKind } from '@rally-gate/shared';
import { In, Repository } from 'typeorm';
import { apiError } from '../../common/api-error';
import { isUniqueViolation } from '../../common/db-errors';
import { EntryClassDto, EntryTransponderDto } from './dto';
import { EntryClass } from './entry-class.entity';
import { Entry } from './entry.entity';

type EntryInput = Partial<Omit<Entry, 'id' | 'classes' | 'transponders'>> & {
  classIds?: string[];
  transponders?: EntryTransponderDto[];
};

export function compareClassNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

/** `undefined` only if the entry was deleted after it drove. */
export function crewOf(entry: Entry | undefined): Crew {
  return {
    driverFirstName: entry?.driverFirstName ?? 'Unknown',
    driverLastName: entry?.driverLastName ?? null,
    driverFlag: entry?.driverFlag ?? null,
    coDriverFirstName: entry?.coDriverFirstName ?? null,
    coDriverLastName: entry?.coDriverLastName ?? null,
    coDriverFlag: entry?.coDriverFlag ?? null,
    chassis: entry?.chassis ?? null,
    body: entry?.body ?? null,
  };
}

@Injectable()
export class EntriesService {
  constructor(
    @InjectRepository(Entry)
    private readonly entries: Repository<Entry>,
    @InjectRepository(EntryClass)
    private readonly classes: Repository<EntryClass>,
  ) {}

  findAll(): Promise<Entry[]> {
    return this.entries.find({ order: { startNumber: 'ASC' } });
  }

  findOne(id: string): Promise<Entry | null> {
    return this.entries.findOneBy({ id });
  }

  /** Every car carrying it: none is unregistered, several is for a marshal. */
  findByTransponder(
    kind: TransponderKind,
    identifier: string,
  ): Promise<Entry[]> {
    return this.entries.find({ where: { transponders: { kind, identifier } } });
  }

  async create({ classIds, ...data }: EntryInput): Promise<Entry> {
    const entry = this.entries.create(data);
    entry.classes = (await this.resolveClasses(classIds)) ?? [];
    try {
      return await this.entries.save(entry);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          apiError(
            ApiErrorCode.START_NUMBER_TAKEN,
            `Start number ${data.startNumber} is already in use`,
            { startNumber: data.startNumber },
          ),
        );
      }
      throw err;
    }
  }

  async update(id: string, { classIds, ...patch }: EntryInput): Promise<Entry> {
    const entry = await this.findOne(id);
    if (!entry) {
      throw new NotFoundException(
        apiError(ApiErrorCode.ENTRY_NOT_FOUND, `Entry ${id} not found`),
      );
    }
    // The validated DTO carries every declared field as an own property, unset
    // ones as `undefined` (ES2022+ class fields). Copied over, they'd blank the
    // returned entry even though save() skips them — `null` still clears.
    Object.assign(
      entry,
      Object.fromEntries(
        Object.entries(patch).filter(([, value]) => value !== undefined),
      ),
    );
    const classes = await this.resolveClasses(classIds);
    if (classes) {
      entry.classes = classes;
    }
    try {
      return await this.entries.save(entry);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          apiError(
            ApiErrorCode.START_NUMBER_TAKEN,
            `Start number ${entry.startNumber} is already in use`,
            { startNumber: entry.startNumber },
          ),
        );
      }
      throw err;
    }
  }

  /** Main classes first, then alphabetical — sorted here, not in SQL, so case
   * and numbers ("2WD" before "10WD") sort alike on SQLite and Postgres. */
  async findAllClasses(): Promise<EntryClass[]> {
    return (await this.classes.find()).sort(
      (a, b) =>
        Number(b.main) - Number(a.main) || compareClassNames(a.name, b.name),
    );
  }

  findClass(id: string): Promise<EntryClass | null> {
    return this.classes.findOneBy({ id });
  }

  createClass({ name, main }: EntryClassDto): Promise<EntryClass> {
    return this.saveClass(this.classes.create({ name, main: main ?? false }));
  }

  async updateClass(
    id: string,
    { name, main }: EntryClassDto,
  ): Promise<EntryClass> {
    const entryClass = await this.findClass(id);
    if (!entryClass) {
      throw new NotFoundException(
        apiError(ApiErrorCode.CLASS_NOT_FOUND, `Class ${id} not found`),
      );
    }
    entryClass.name = name;
    if (main !== undefined) {
      entryClass.main = main;
    }
    return this.saveClass(entryClass);
  }

  async removeClass(id: string): Promise<void> {
    const { affected } = await this.classes.delete(id);
    if (!affected) {
      throw new NotFoundException(
        apiError(ApiErrorCode.CLASS_NOT_FOUND, `Class ${id} not found`),
      );
    }
  }

  private async saveClass(entryClass: EntryClass): Promise<EntryClass> {
    try {
      return await this.classes.save(entryClass);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          apiError(
            ApiErrorCode.CLASS_EXISTS,
            `Class ${entryClass.name} already exists`,
            { name: entryClass.name },
          ),
        );
      }
      throw err;
    }
  }

  private async resolveClasses(
    classIds?: string[],
  ): Promise<EntryClass[] | undefined> {
    if (classIds === undefined) {
      return undefined;
    }
    const ids = [...new Set(classIds)];
    if (ids.length === 0) {
      return [];
    }
    const classes = await this.classes.findBy({ id: In(ids) });
    if (classes.length !== ids.length) {
      throw new BadRequestException(
        apiError(ApiErrorCode.CLASS_NOT_FOUND, 'Unknown entry class'),
      );
    }
    return classes;
  }
}
