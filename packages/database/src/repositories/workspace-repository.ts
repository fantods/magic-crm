import { workspaceIdSchema, type Workspace } from '@formless/contracts';
import { mapWorkspaceRow, type DatabaseExecutor } from '../mapping.js';

export class WorkspaceRepository {
  async ensure(
    executor: DatabaseExecutor,
    workspaceId: string,
    displayName: string = workspaceId,
  ): Promise<Workspace> {
    const id = workspaceIdSchema.parse(workspaceId);

    const result = await executor.query(
      `
      INSERT INTO workspaces(id, display_name)
      VALUES ($1, $2)
      ON CONFLICT (id) DO UPDATE SET updated_at = workspaces.updated_at
      RETURNING id, display_name, created_at, updated_at
    `,
      [id, displayName],
    );

    return mapWorkspaceRow(result.rows[0]!);
  }

  async get(executor: DatabaseExecutor, workspaceId: string): Promise<Workspace | null> {
    const id = workspaceIdSchema.parse(workspaceId);
    const result = await executor.query(
      `
        SELECT id, display_name, created_at, updated_at
        FROM workspaces
        WHERE id = $1
      `,
      [id],
    );

    return result.rows[0] ? mapWorkspaceRow(result.rows[0]) : null;
  }
}
