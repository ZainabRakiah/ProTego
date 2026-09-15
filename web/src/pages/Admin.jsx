import * as React from "react";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { toast } from "sonner";
import {
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Clock,
  RotateCcw,
  Cpu,
  FileText,
  AlertTriangle,
  Sparkles,
  Search,
  Filter,
  RefreshCw,
  Eye,
} from "lucide-react";

export default function Admin() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = React.useState("pending");

  // State
  const [reports, setReports] = React.useState([]);
  const [verifiedIncidents, setVerifiedIncidents] = React.useState([]);
  const [models, setModels] = React.useState([]);
  const [currentProdModel, setCurrentProdModel] = React.useState(null);
  const [auditTrail, setAuditTrail] = React.useState([]);

  const [loading, setLoading] = React.useState(true);
  const [actionLoading, setActionLoading] = React.useState(false);

  // Review Modal State
  const [selectedReport, setSelectedReport] = React.useState(null);
  const [reviewerNotes, setReviewerNotes] = React.useState("");

  const isUserAdmin = user?.is_admin || user?.email === "admin@protego.com";

  const loadData = React.useCallback(async () => {
    setLoading(true);
    try {
      const [reportsRes, verifiedRes, modelsRes, auditRes] = await Promise.all([
        api.adminGetReports("ALL").catch(() => ({ reports: [] })),
        api.adminGetVerifiedIncidents().catch(() => ({ verified_incidents: [] })),
        api.adminGetModels().catch(() => ({ models: [], current_production_model: null })),
        api.adminGetAuditTrail().catch(() => ({ audit_events: [] })),
      ]);

      setReports(reportsRes.reports || []);
      setVerifiedIncidents(verifiedRes.verified_incidents || []);
      setModels(modelsRes.models || []);
      setCurrentProdModel(modelsRes.current_production_model || null);
      setAuditTrail(auditRes.audit_events || []);
    } catch (err) {
      toast.error(err.message || "Failed to load admin management data");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadData();
  }, [loadData]);

  const handleReview = async (action) => {
    if (!selectedReport) return;
    setActionLoading(true);
    try {
      const res = await api.adminReviewReport(selectedReport.id, {
        action,
        reviewer_id: user?.id,
        reviewer_notes: reviewerNotes,
      });

      toast.success(res.message || `Incident ${action.toLowerCase()}d successfully!`);
      setSelectedReport(null);
      setReviewerNotes("");
      loadData();
    } catch (err) {
      toast.error(err.message || `Failed to ${action.toLowerCase()} incident`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleTriggerRetrain = async () => {
    setActionLoading(true);
    try {
      toast.info("Retraining candidate model and evaluating Quality Gate...");
      const res = await api.adminTriggerRetrain(user?.id);
      if (res.success) {
        toast.success(res.message || "Model retrained and deployed successfully!");
      } else {
        toast.warning(res.message || "Retraining completed but candidate failed Quality Gate.");
      }
      loadData();
    } catch (err) {
      toast.error(err.message || "Retraining pipeline failed");
    } finally {
      setActionLoading(false);
    }
  };

  const handleRollback = async (versionStr) => {
    if (!window.confirm(`Are you sure you want to rollback production model to version ${versionStr}?`)) {
      return;
    }
    setActionLoading(true);
    try {
      const res = await api.adminRollbackModel(versionStr, user?.id);
      toast.success(res.message || "Rollback completed successfully!");
      loadData();
    } catch (err) {
      toast.error(err.message || "Model rollback failed");
    } finally {
      setActionLoading(false);
    }
  };

  if (!isUserAdmin) {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center p-6 text-center">
        <ShieldCheck className="mb-4 size-16 text-destructive" />
        <h2 className="text-2xl font-bold tracking-tight">Access Restricted</h2>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          You must be logged in as an Administrator (e.g. <code>admin@protego.com</code>) to access the Human-in-the-Loop Continual Learning control panel.
        </p>
      </div>
    );
  }

  const pendingReports = reports.filter(
    (r) => (r.verification_status || "PENDING").toUpperCase() === "PENDING"
  );
  const approvedReports = reports.filter(
    (r) => (r.verification_status || "").toUpperCase() === "APPROVED"
  );
  const rejectedReports = reports.filter(
    (r) => (r.verification_status || "").toUpperCase() === "REJECTED"
  );

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-4 sm:p-6 lg:p-8">
      {/* Header Banner */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-violet-900/60 via-purple-900/40 to-slate-900 p-6 sm:p-8 border border-white/10 backdrop-blur-xl shadow-2xl">
        <div className="relative z-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center rounded-full bg-violet-500/20 px-3 py-1 text-xs font-semibold text-violet-300 ring-1 ring-violet-500/30">
                <Sparkles className="mr-1 size-3.5" /> Human-in-the-Loop Continual Learning
              </span>
            </div>
            <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
              ProTego Governance Dashboard
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-300">
              Verify incident reports, monitor spatial feature updates, oversee model retraining quality gates, and manage versioning.
            </p>
          </div>
          <button
            onClick={loadData}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/20 active:scale-95 disabled:opacity-50"
          >
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm transition hover:border-amber-500/50">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Pending Review</span>
            <div className="rounded-full bg-amber-500/10 p-2 text-amber-500">
              <Clock className="size-5" />
            </div>
          </div>
          <p className="mt-3 text-3xl font-bold">{pendingReports.length}</p>
          <p className="mt-1 text-xs text-muted-foreground">Unverified incident reports</p>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm transition hover:border-emerald-500/50">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Verified Dataset</span>
            <div className="rounded-full bg-emerald-500/10 p-2 text-emerald-500">
              <CheckCircle2 className="size-5" />
            </div>
          </div>
          <p className="mt-3 text-3xl font-bold">{verifiedIncidents.length}</p>
          <p className="mt-1 text-xs text-muted-foreground">Human-verified spatial incidents</p>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm transition hover:border-violet-500/50">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Production Model</span>
            <div className="rounded-full bg-violet-500/10 p-2 text-violet-500">
              <Cpu className="size-5" />
            </div>
          </div>
          <p className="mt-3 text-2xl font-bold font-mono">
            {currentProdModel?.model_version || "v1.0 (Baseline)"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            RMSE: {currentProdModel?.evaluation_metrics?.rmse ?? "0.000"} | Tested
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm transition hover:border-blue-500/50">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Audit Trail</span>
            <div className="rounded-full bg-blue-500/10 p-2 text-blue-500">
              <FileText className="size-5" />
            </div>
          </div>
          <p className="mt-3 text-3xl font-bold">{auditTrail.length}</p>
          <p className="mt-1 text-xs text-muted-foreground">System audit logs recorded</p>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex border-b border-border space-x-2 overflow-x-auto pb-2">
        <button
          onClick={() => setActiveTab("pending")}
          className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition ${
            activeTab === "pending"
              ? "bg-primary text-primary-foreground shadow-md"
              : "text-muted-foreground hover:bg-accent hover:text-foreground"
          }`}
        >
          <Clock className="size-4" /> Pending Review
          {pendingReports.length > 0 && (
            <span className="ml-1 rounded-full bg-amber-500 px-2 py-0.5 text-xs text-black font-semibold">
              {pendingReports.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab("verified")}
          className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition ${
            activeTab === "verified"
              ? "bg-primary text-primary-foreground shadow-md"
              : "text-muted-foreground hover:bg-accent hover:text-foreground"
          }`}
        >
          <CheckCircle2 className="size-4" /> Verified Incidents ({verifiedIncidents.length})
        </button>

        <button
          onClick={() => setActiveTab("models")}
          className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition ${
            activeTab === "models"
              ? "bg-primary text-primary-foreground shadow-md"
              : "text-muted-foreground hover:bg-accent hover:text-foreground"
          }`}
        >
          <Cpu className="size-4" /> Continual Retraining & Models ({models.length})
        </button>

        <button
          onClick={() => setActiveTab("audit")}
          className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition ${
            activeTab === "audit"
              ? "bg-primary text-primary-foreground shadow-md"
              : "text-muted-foreground hover:bg-accent hover:text-foreground"
          }`}
        >
          <FileText className="size-4" /> Audit Trail ({auditTrail.length})
        </button>
      </div>

      {/* Tab 1: Pending Incidents Review */}
      {activeTab === "pending" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Incident Reports Awaiting Verification</h3>
            <span className="text-xs text-muted-foreground">
              Only APPROVED reports enter ML training & spatial grid features.
            </span>
          </div>

          {pendingReports.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border p-12 text-center">
              <CheckCircle2 className="mx-auto size-12 text-muted-foreground/50" />
              <h4 className="mt-4 text-base font-semibold">All caught up!</h4>
              <p className="mt-1 text-sm text-muted-foreground">No pending incident reports require human review right now.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {pendingReports.map((r) => (
                <div
                  key={r.id}
                  className="flex flex-col justify-between rounded-2xl border border-border bg-card p-5 shadow-sm transition hover:border-violet-500/40"
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-500">
                        PENDING
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {r.timestamp ? new Date(r.timestamp * 1000).toLocaleString() : r.created_at}
                      </span>
                    </div>

                    <div>
                      <h4 className="font-semibold text-foreground capitalize">
                        {r.incident_type || r.location_label || "Incident Report"}
                      </h4>
                      <p className="mt-1 text-xs text-muted-foreground line-clamp-3">
                        {r.description || "No description provided."}
                      </p>
                    </div>

                    <div className="rounded-lg bg-accent/50 p-2.5 text-xs space-y-1">
                      <div><strong className="text-muted-foreground">Reporter:</strong> {r.reporter_name || r.user_id || "Anonymous"}</div>
                      <div><strong className="text-muted-foreground">Coordinates:</strong> {r.lat ? `${r.lat.toFixed(4)}, ${r.lng.toFixed(4)}` : "None"}</div>
                    </div>

                    {r.image_base64 && (
                      <div className="overflow-hidden rounded-lg border border-border bg-black/40">
                        <img src={r.image_base64} alt="Evidence" className="h-32 w-full object-cover" />
                      </div>
                    )}
                  </div>

                  <div className="mt-4 pt-4 border-t border-border flex items-center justify-end gap-2">
                    <button
                      onClick={() => {
                        setSelectedReport(r);
                        setReviewerNotes("");
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition hover:opacity-90"
                    >
                      <Eye className="size-3.5" /> Review Report
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Verified Incidents */}
      {activeTab === "verified" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Human-Verified Spatial Incident Dataset</h3>
            <span className="text-xs text-muted-foreground">
              These incidents update spatial features and fuel continual model learning.
            </span>
          </div>

          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="p-4">Verified ID</th>
                    <th className="p-4">Type</th>
                    <th className="p-4">Coordinates</th>
                    <th className="p-4">Grid Cell</th>
                    <th className="p-4">Verified At</th>
                    <th className="p-4">Verified By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {verifiedIncidents.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-muted-foreground">
                        No verified incidents in dataset yet.
                      </td>
                    </tr>
                  ) : (
                    verifiedIncidents.map((v) => (
                      <tr key={v.id || v.verified_incident_id} className="hover:bg-muted/20">
                        <td className="p-4 font-mono text-xs">{v.verified_incident_id || v.id}</td>
                        <td className="p-4 font-medium capitalize">{v.incident_type}</td>
                        <td className="p-4 text-xs font-mono">{v.lat?.toFixed(4)}, {v.lng?.toFixed(4)}</td>
                        <td className="p-4 text-xs font-mono text-violet-400">
                          ({v.cell_lat?.toFixed(4)}, {v.cell_lon?.toFixed(4)})
                        </td>
                        <td className="p-4 text-xs text-muted-foreground">
                          {v.verified_at ? new Date(v.verified_at * 1000).toLocaleString() : "-"}
                        </td>
                        <td className="p-4 text-xs">{v.verified_by || "Admin"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: Continual Retraining & Models */}
      {activeTab === "models" && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-violet-500/20 bg-violet-950/20 p-6 backdrop-blur-md">
            <div>
              <h3 className="text-lg font-bold text-violet-200">Continual Learning Retraining Trigger</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Triggers when newly approved incidents reach threshold or manually by administrator. Retrained candidate models must pass the Quality Gate.
              </p>
            </div>
            <button
              onClick={handleTriggerRetrain}
              disabled={actionLoading}
              className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-600/30 transition hover:bg-violet-500 active:scale-95 disabled:opacity-50"
            >
              <Sparkles className="size-4" /> Trigger Retraining & Quality Gate
            </button>
          </div>

          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Model Version Registry</h3>
            <div className="space-y-3">
              {models.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border p-8 text-center text-muted-foreground">
                  No custom model versions recorded yet. Using baseline Safety XGBoost model.
                </div>
              ) : (
                models.map((m) => {
                  const isProd = m.deployment_status === "PRODUCTION";
                  const isRejected = m.deployment_status === "REJECTED";
                  const isRolledBack = m.deployment_status === "ROLLED_BACK";

                  return (
                    <div
                      key={m.id || m.model_version}
                      className={`flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 rounded-2xl border p-5 transition ${
                        isProd
                          ? "border-emerald-500/50 bg-emerald-950/10 shadow-lg shadow-emerald-500/5"
                          : isRejected
                          ? "border-destructive/40 bg-destructive/5"
                          : "border-border bg-card"
                      }`}
                    >
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-base font-bold">{m.model_version}</span>
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                              isProd
                                ? "bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/40"
                                : isRejected
                                ? "bg-destructive/20 text-destructive ring-1 ring-destructive/40"
                                : isRolledBack
                                ? "bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/40"
                                : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {m.deployment_status}
                          </span>
                        </div>

                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          <div><strong>Type:</strong> {m.model_type}</div>
                          <div><strong>Created:</strong> {m.created_at_iso || new Date(m.created_at * 1000).toLocaleString()}</div>
                          <div><strong>Verified Incidents:</strong> {m.number_of_verified_incidents}</div>
                        </div>

                        {m.evaluation_metrics && (
                          <div className="flex gap-3 text-xs font-mono pt-1">
                            <span className="rounded bg-accent/60 px-2 py-0.5">RMSE: {m.evaluation_metrics.rmse}</span>
                            <span className="rounded bg-accent/60 px-2 py-0.5">MAE: {m.evaluation_metrics.mae}</span>
                            <span className="rounded bg-accent/60 px-2 py-0.5">R²: {m.evaluation_metrics.r2}</span>
                          </div>
                        )}

                        {m.rejection_reason && (
                          <p className="text-xs text-destructive font-medium">⚠️ {m.rejection_reason}</p>
                        )}
                      </div>

                      {!isProd && (
                        <button
                          onClick={() => handleRollback(m.model_version)}
                          disabled={actionLoading}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-400 hover:bg-amber-500/20 transition disabled:opacity-50"
                        >
                          <RotateCcw className="size-3.5" /> Rollback to This
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tab 4: Audit Trail */}
      {activeTab === "audit" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">System Continual Learning Audit Log</h3>
            <span className="text-xs text-muted-foreground">Immutable audit records for compliance and research reproducibility.</span>
          </div>

          <div className="space-y-2">
            {auditTrail.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border p-8 text-center text-muted-foreground">
                No audit events recorded yet.
              </div>
            ) : (
              auditTrail.map((item, idx) => (
                <div key={item.id || idx} className="rounded-xl border border-border bg-card p-4 text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold text-violet-400">{item.event_type}</span>
                    <span className="text-muted-foreground">{item.created_at || new Date(item.timestamp * 1000).toLocaleString()}</span>
                  </div>
                  <div><strong className="text-muted-foreground">Actor:</strong> {item.actor}</div>
                  {item.details && (
                    <pre className="mt-1 overflow-x-auto rounded bg-muted/40 p-2 font-mono text-[11px] text-muted-foreground">
                      {JSON.stringify(item.details, null, 2)}
                    </pre>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Review Modal */}
      {selectedReport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-3xl border border-border bg-card p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in duration-200">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold">Review Incident Report</h3>
              <button
                onClick={() => setSelectedReport(null)}
                className="rounded-full p-1 text-muted-foreground hover:bg-accent"
              >
                <XCircle className="size-5" />
              </button>
            </div>

            <div className="space-y-3 text-sm">
              <div className="rounded-xl bg-muted/40 p-3 space-y-1.5">
                <div><strong>Type:</strong> {selectedReport.incident_type || "General Safety"}</div>
                <div><strong>Reporter:</strong> {selectedReport.reporter_name || selectedReport.user_id}</div>
                <div><strong>Coordinates:</strong> {selectedReport.lat}, {selectedReport.lng}</div>
                <div><strong>Description:</strong> {selectedReport.description}</div>
              </div>

              {selectedReport.image_base64 && (
                <div className="overflow-hidden rounded-xl border border-border">
                  <img src={selectedReport.image_base64} alt="Submitted Evidence" className="max-h-48 w-full object-cover" />
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">Reviewer Notes / Reason</label>
                <textarea
                  value={reviewerNotes}
                  onChange={(e) => setReviewerNotes(e.target.value)}
                  placeholder="Enter justification or reviewer notes..."
                  className="w-full rounded-xl border border-input bg-background p-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  rows={3}
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => handleReview("REJECT")}
                disabled={actionLoading}
                className="inline-flex items-center gap-1.5 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm font-semibold text-destructive hover:bg-destructive/20 transition disabled:opacity-50"
              >
                <XCircle className="size-4" /> Reject Report
              </button>

              <button
                onClick={() => handleReview("APPROVE")}
                disabled={actionLoading}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-emerald-600/30 hover:bg-emerald-500 transition disabled:opacity-50"
              >
                <CheckCircle2 className="size-4" /> Approve & Update Spatial Features
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
