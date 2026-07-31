import { redirect } from "next/navigation";
import { AdminNav } from "@/components/admin-nav";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { UserRole, AttemptStatus } from "@prisma/client";

export default async function AdminDashboard() {
  const session = await requireAuth([UserRole.ADMIN]);
  if (!session) redirect("/login");

  const [candidates, templates, activeAttempts, completedAttempts] = await Promise.all([
    prisma.user.count({ where: { role: UserRole.CANDIDATE, enabled: true } }),
    prisma.scenarioTemplate.count({ where: { enabled: true } }),
    prisma.attempt.count({ where: { status: AttemptStatus.IN_PROGRESS } }),
    prisma.attempt.count({ where: { status: AttemptStatus.COMPLETED } }),
  ]);

  return (
    <>
      <AdminNav />
      <div className="container">
        <div className="page-header">
          <h1>Admin Dashboard</h1>
          <p>Manage assessments, templates, and candidates.</p>
        </div>
        <div className="grid-4">
          <div className="stat-card">
            <h3>Active candidates</h3>
            <p className="stat-value">{candidates}</p>
          </div>
          <div className="stat-card">
            <h3>Enabled templates</h3>
            <p className="stat-value">{templates}</p>
          </div>
          <div className="stat-card">
            <h3>Live sessions</h3>
            <p className="stat-value">{activeAttempts}</p>
          </div>
          <div className="stat-card">
            <h3>Completed</h3>
            <p className="stat-value">{completedAttempts}</p>
          </div>
        </div>
      </div>
    </>
  );
}
