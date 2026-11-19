import { ForbiddenException, Injectable } from '@nestjs/common';
import { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class RbacService {
  constructor(private readonly db: PrismaService) {}
  admin(user: Pick<User, 'role'>) { if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException('Chỉ Super Admin được thực hiện thao tác này.'); }
  async page(user: Pick<User, 'id' | 'role'>, pageId: string) {
    if (user.role === 'SUPER_ADMIN') return;
    const member = await this.db.pageMember.findUnique({ where: { userId_pageId: { pageId, userId: user.id } } });
    if (!member) throw new ForbiddenException('Bạn không có quyền truy cập fanpage này.');
  }
}
