import { useEffect, useMemo, useState } from "react";
import {
  addDomainsToGroup,
  addDomainToGroup,
  uploadGroupExcel,
  addGroupMember,
  checkAllGroupDomains,
  checkDomain,
  createDashboard,
  createGroup,
  deleteDashboard,
  getDashboardById,
  getDashboards,
  getDomains,
  getGroup,
  getGroups,
  joinGroup,
  removeDomainFromGroup,
  removeGroupMember,
  requestGroupPermission,
  reviewEditRequest,
  reviewGroupPermissionRequest,
  reviewDomainAddRequest,
  updateDomain,
  updateGroupMember,
} from "../api";
import StatCard from "../components/StatCard";
import StatusBadge from "../components/StatusBadge";

function DomainLink({ url }) {
  return <a className="domain-link" href={url} target="_blank" rel="noopener noreferrer">{url}</a>;
}

function statsFromDomains(domains) {
  const count = (name) => domains.filter((d) => d.status === name).length;
  const times = domains.map((d) => Number(d.response_time_ms)).filter(Number.isFinite);
  return {
    total: domains.length,
    ok: count("OK"),
    redirects: count("Redirect"),
    client_errors: count("Client Error"),
    server_errors: count("Server Error"),
    unreachable: count("Unreachable"),
    avg_response_time: times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0,
  };
}

export default function Groups() {
  const [groups, setGroups] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [group, setGroup] = useState(null);
  const [allDomains, setAllDomains] = useState([]);
  const [name, setName] = useState("");
  const [selectedDomains, setSelectedDomains] = useState([]);
  const [joinCode, setJoinCode] = useState("");
  const [email, setEmail] = useState("");
  const [permission, setPermission] = useState("view");
  const [requestedPermission, setRequestedPermission] = useState("edit");
  const [requestMessage, setRequestMessage] = useState("");
  const [message, setMessage] = useState("");
  const [dashboard, setDashboard] = useState(null);
  const [dashboards, setDashboards] = useState([]);
  const [dashboardName, setDashboardName] = useState("");
  const [dashboardGroupId, setDashboardGroupId] = useState("");
  const [busy, setBusy] = useState(false);
  const [checkingIds, setCheckingIds] = useState(() => new Set());
  const [checkingAll, setCheckingAll] = useState(false);
  const [editingDomainId, setEditingDomainId] = useState(null);
  const [editingDomainValue, setEditingDomainValue] = useState("");
  const [groupDomainInput, setGroupDomainInput] = useState("");
  const [groupActionBusy, setGroupActionBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState("");
  const [permissionDrafts, setPermissionDrafts] = useState({});

  async function loadGroups() {
    const response = await getGroups();
    setGroups(response.data);
    return response.data;
  }

  async function loadGroup(id) {
    const response = await getGroup(id);
    setGroup(response.data);
    return response.data;
  }

  async function loadDashboards() {
    const response = await getDashboards();
    setDashboards(response.data);
  }

  useEffect(() => {
    Promise.all([loadGroups(), getDomains().then((r) => setAllDomains(r.data)), loadDashboards()])
      .catch((e) => setMessage(e.response?.data?.message || "Could not load groups."));
  }, []);

  async function openGroup(id) {
    try {
      setBusy(true);
      await loadGroup(id);
      setPermissionDrafts({});
      setSelectedId(id);
      setDashboard(null);
    } catch (e) {
      setMessage(e.response?.data?.message || "Could not load group dashboard.");
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    if (!name.trim()) return;
    try {
      setBusy(true);
      const response = await createGroup({ name, domainIds: selectedDomains });
      setMessage(`Group created. Share join code ${response.data.join_code}.`);
      setName("");
      setSelectedDomains([]);
      await loadGroups();
      await openGroup(response.data.id);
    } catch (e) {
      setMessage(e.response?.data?.message || "Could not create group.");
    } finally {
      setBusy(false);
    }
  }

  async function join() {
    if (!joinCode.trim()) return;
    try {
      setBusy(true);
      const response = await joinGroup(joinCode);
      setMessage(response.data.message);
      setJoinCode("");
      await loadGroups();
      if (response.data.group?.id) await openGroup(response.data.group.id);
    } catch (e) {
      setMessage(e.response?.data?.message || "Could not join group.");
    } finally {
      setBusy(false);
    }
  }

  async function addMember() {
    try {
      setActionBusy("add-member");
      await addGroupMember(selectedId, { email, permission });
      setEmail("");
      setMessage("Member permission saved.");
      await loadGroup(selectedId);
    } catch (e) {
      setMessage(e.response?.data?.message || "Could not add member.");
    } finally {
      setActionBusy("");
    }
  }

  function perm(id, value) {
    setPermissionDrafts((current) => ({ ...current, [id]: value }));
    setMessage("Permission changed locally. Click Save to apply it.");
  }

  async function saveMemberPermission(id) {
    const value = permissionDrafts[id];
    if (!value) return;
    try {
      setActionBusy(`permission-${id}`);
      await updateGroupMember(selectedId, id, { permission: value });
      setPermissionDrafts((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      setMessage("Member permission saved successfully.");
      await loadGroup(selectedId);
    } catch (e) {
      setMessage(e.response?.data?.message || "Could not update permission.");
    } finally {
      setActionBusy("");
    }
  }

  async function removeMember(id) {
    if (!window.confirm("Remove this member?")) return;
    try {
      setActionBusy(`remove-${id}`);
      await removeGroupMember(selectedId, id);
      await loadGroup(selectedId);
    } catch (e) {
      setMessage(e.response?.data?.message || "Could not remove member.");
    } finally {
      setActionBusy("");
    }
  }

  async function addDomains() {
    if (!selectedDomains.length) return;
    try {
      setGroupActionBusy(true);
      await addDomainsToGroup(selectedId, selectedDomains);
      setSelectedDomains([]);
      await Promise.all([loadGroup(selectedId), loadGroups(), getDomains().then((r) => setAllDomains(r.data))]);
      setMessage("Domains added to group.");
    } catch (e) {
      setMessage(e.response?.data?.message || "Could not add domains.");
    } finally {
      setGroupActionBusy(false);
    }
  }

  async function removeDomain(id) {
    try {
      setGroupActionBusy(true);
      await removeDomainFromGroup(selectedId, id);
      await Promise.all([loadGroup(selectedId), loadGroups(), getDomains().then((r) => setAllDomains(r.data))]);
      setMessage("Domain removed from group.");
    } catch (e) {
      setMessage(e.response?.data?.message || "Could not remove domain.");
    } finally {
      setGroupActionBusy(false);
    }
  }

  async function checkOneDomain(id) {
    if (checkingAll || checkingIds.has(id)) return;
    setCheckingIds((current) => new Set(current).add(id));
    try {
      const response = await checkDomain(id);
      setGroup((current) => {
        if (!current) return current;
        const nextDomains = current.domains.map((d) => d.id === id ? { ...d, ...response.data } : d);
        return { ...current, domains: nextDomains, stats: statsFromDomains(nextDomains) };
      });
    } catch (e) {
      setMessage(e.response?.data?.message || "Check failed.");
    } finally {
      setCheckingIds((current) => { const next = new Set(current); next.delete(id); return next; });
    }
  }

  async function handleCheckAllGroupDomains() {
    if (checkingAll || checkingIds.size || !group?.domains?.length) return;
    setCheckingAll(true);
    try {
      const response = await checkAllGroupDomains(selectedId);
      const byId = new Map(response.data.domains.map((d) => [Number(d.id), d]));
      setGroup((current) => {
        if (!current) return current;
        const nextDomains = current.domains.map((d) => byId.get(Number(d.id)) || d);
        return { ...current, domains: nextDomains, stats: statsFromDomains(nextDomains) };
      });
      setMessage(`Checked ${response.data.domains.length} enabled group domain(s).`);
    } catch (e) {
      setMessage(e.response?.data?.message || "Could not check all domains.");
    } finally {
      setCheckingAll(false);
    }
  }

  async function saveDomainEdit(id) {
    try {
      setActionBusy(`save-edit-${id}`);
      const response = await updateDomain(id, { domain: editingDomainValue });
      setEditingDomainId(null);
      setGroup((current) => current ? {
        ...current,
        domains: current.domains.map((d) => d.id === id && !response.data.pending ? { ...d, ...response.data } : d),
      } : current);
      setMessage(response.data.pending ? "Edit request sent to the group owner for approval." : "Domain updated.");
    } catch (e) {
      setMessage(e.response?.data?.message || "Could not edit domain.");
    } finally {
      setActionBusy("");
    }
  }

  async function addSingleGroupDomain() {
    const value = groupDomainInput.trim();
    if (!value || groupActionBusy) return;
    try {
      setGroupActionBusy(true);
      const response = await addDomainToGroup(selectedId, value);
      setGroupDomainInput("");
      if (response.data.pending) {
        await loadGroup(selectedId);
        setMessage(response.data.message || "Domain addition sent for approval.");
        return;
      }
      setGroup((current) => {
        if (!current) return current;
        const next = [response.data, ...current.domains.filter((d) => d.id !== response.data.id)];
        return { ...current, domains: next, stats: statsFromDomains(next) };
      });
      setMessage("Domain added and checked successfully.");
    } catch (e) {
      setMessage(e.response?.data?.message || "Could not add the group domain.");
    } finally {
      setGroupActionBusy(false);
    }
  }

  async function handleGroupUpload(e) {
    const file = e.target.files?.[0];
    if (!file || groupActionBusy) return;
    try {
      setGroupActionBusy(true);
      const response = await uploadGroupExcel(selectedId, file);
      await loadGroup(selectedId);
      setMessage(response.data.message || `Upload complete: ${response.data.added} added, ${response.data.skipped} skipped.`);
    } catch (e) {
      setMessage(e.response?.data?.message || "Could not upload group domains.");
    } finally {
      setGroupActionBusy(false);
      e.target.value = "";
    }
  }

  async function requestPermission() {
    try {
      setActionBusy("permission-request");
      await requestGroupPermission(selectedId, requestedPermission, requestMessage);
      setRequestMessage("");
      setMessage("Permission request sent to the group owner.");
      await loadGroup(selectedId);
    } catch (e) {
      setMessage(e.response?.data?.message || "Could not send permission request.");
    } finally {
      setActionBusy("");
    }
  }

  async function reviewPermission(id, decision) {
    try {
      setActionBusy(`permission-review-${id}`);
      await reviewGroupPermissionRequest(selectedId, id, decision);
      await loadGroup(selectedId);
      setMessage(`Permission request ${decision}.`);
    } catch (e) {
      setMessage(e.response?.data?.message || "Could not review permission request.");
    } finally {
      setActionBusy("");
    }
  }

  async function reviewEdit(id, decision) {
    try {
      setActionBusy(`edit-review-${id}`);
      await reviewEditRequest(selectedId, id, decision);
      await loadGroup(selectedId);
      setMessage(`Edit ${decision}.`);
    } catch (e) {
      setMessage(e.response?.data?.message || "Could not review edit request.");
    } finally {
      setActionBusy("");
    }
  }

  async function reviewDomainAdd(id, decision) {
    try {
      setActionBusy(`add-review-${id}`);
      await reviewDomainAddRequest(selectedId, id, decision);
      await loadGroup(selectedId);
      setMessage(`Domain addition ${decision}.`);
    } catch (e) {
      setMessage(e.response?.data?.message || "Could not review domain addition.");
    } finally {
      setActionBusy("");
    }
  }

  async function makeDashboard() {
    try {
      setBusy(true);
      await createDashboard({ name: dashboardName, groupId: dashboardGroupId || null });
      setDashboardName("");
      setDashboardGroupId("");
      await loadDashboards();
      setMessage("Dashboard created.");
    } catch (e) {
      setMessage(e.response?.data?.message || "Could not create dashboard.");
    } finally {
      setBusy(false);
    }
  }

  async function openSavedDashboard(id) {
    try {
      setBusy(true);
      const response = await getDashboardById(id);
      setDashboard(response.data);
    } catch (e) {
      setMessage(e.response?.data?.message || "Could not open dashboard.");
    } finally {
      setBusy(false);
    }
  }

  async function removeSavedDashboard(id) {
    if (!window.confirm("Delete this dashboard?")) return;
    try {
      await deleteDashboard(id);
      setDashboards((current) => current.filter((d) => d.id !== id));
      if (dashboard?.dashboard?.id === id) setDashboard(null);
    } catch (e) {
      setMessage(e.response?.data?.message || "Could not delete dashboard.");
    }
  }

  const groupAdmin = group?.group?.permission === "admin" || Number(group?.group?.owner_id) === Number(group?.owner_id);
  const memberPermission = groupAdmin ? "admin" : (group?.group?.permission || "view");
  const groupedIds = new Set((group?.domains || []).map((d) => Number(d.id)));
  const selectableDomains = useMemo(
    () => allDomains.filter((d) => d.permission === "admin" && !groupedIds.has(Number(d.id))),
    [allDomains, groupedIds]
  );
  const canDirectManageDomains = groupAdmin || memberPermission === "edit_privileged";
  const canEditDomains = canDirectManageDomains || memberPermission === "edit";

  if (selectedId && group) {
    return (
      <div>
    <div className="page-header">
      <div>
        <span className="eyebrow">Shared workspace dashboard</span>
        <h1>{group.group.name}</h1>
        <p>Group ID: <code>{group.group.id}</code> · Owner ID: <code>{group.group.owner_id}</code> · Your permission: <b>{memberPermission}</b></p>
      </div>
      <button className="small back-button" onClick={() => { setSelectedId(null); setGroup(null); }}>← Back to groups</button>
    </div>

    {message && <div className="message panel">{message}</div>}

    <section className="panel group-summary">
      <div><strong>Group ID</strong><span>{group.group.id}</span></div>
      <div><strong>Group name</strong><span>{group.group.name}</span></div>
      <div><strong>Your permission</strong><span>{memberPermission}</span></div>
      <div><strong>Members</strong><span>{1 + group.members.length}</span></div>
      <div><strong>Domains</strong><span>{group.domains.length}</span></div>
      {groupAdmin && <div><strong>Join code</strong><span className="join-code">{group.group.join_code}</span></div>}
    </section>

    <section className="panel group-normal-dashboard">
      <div className="section-title">
        <div><h2>Group dashboard</h2><span>Same monitoring view as your normal dashboard, scoped to this group.</span></div>
        <button className="secondary" onClick={handleCheckAllGroupDomains} disabled={checkingAll || checkingIds.size || !group.domains.length} aria-busy={checkingAll}>
          {checkingAll ? "Checking all…" : "Check all group domains"}
        </button>
      </div>

      {canDirectManageDomains ? (
        <div className="quick-add panel nested-panel">
          <input
            value={groupDomainInput}
            onChange={(e) => setGroupDomainInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addSingleGroupDomain()}
            placeholder="Add a domain or subdomain to this group"
          />
          <button onClick={addSingleGroupDomain} disabled={groupActionBusy || !groupDomainInput.trim()} aria-busy={groupActionBusy}>
            {groupActionBusy ? "Processing…" : "Add Domain"}
          </button>
          <label className={`button upload-button ${groupActionBusy ? "is-busy" : ""}`}>
            {groupActionBusy ? "Uploading…" : "Upload Excel"}
            <input type="file" accept=".xlsx,.xls" hidden onChange={handleGroupUpload} disabled={groupActionBusy} />
          </label>
          {groupAdmin && selectableDomains.length > 0 && (
            <div className="existing-domain-picker">
              <select
                multiple
                value={selectedDomains.map(String)}
                onChange={(e) => setSelectedDomains(Array.from(e.target.selectedOptions, (o) => Number(o.value)))}
                aria-label="Select existing personal domains to share with this group"
              >
                {selectableDomains.map((d) => <option key={d.id} value={d.id}>{d.url}</option>)}
              </select>
              <button className="secondary" onClick={addDomains} disabled={groupActionBusy || !selectedDomains.length}>
                {groupActionBusy ? "Adding…" : "Add selected personal domains"}
              </button>
            </div>
          )}
        </div>
      ) : memberPermission === "edit" ? (
        <div className="quick-add panel nested-panel">
          <div className="permission-hint"><strong>Edit permission</strong><span>New domains and changes are submitted to the group owner for approval. Nothing becomes visible in the group until approved.</span></div>
          <div className="quick-add-row">
            <input
              value={groupDomainInput}
              onChange={(e) => setGroupDomainInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addSingleGroupDomain()}
              placeholder="Add a domain or subdomain — sends approval request"
            />
            <button onClick={addSingleGroupDomain} disabled={groupActionBusy || !groupDomainInput.trim()} aria-busy={groupActionBusy}>
              {groupActionBusy ? "Sending…" : "Request domain"}
            </button>
            <label className={`button upload-button ${groupActionBusy ? "is-busy" : ""}`}>
              {groupActionBusy ? "Uploading…" : "Upload Excel for approval"}
              <input type="file" accept=".xlsx,.xls" hidden onChange={handleGroupUpload} disabled={groupActionBusy} />
            </label>
          </div>
        </div>
      ) : (
        <div className="notice-card">
          <strong>View permission</strong>
          <span>You can monitor and check the group domains. Editing or adding domains is restricted until the owner grants a higher permission.</span>
        </div>
      )}
    </section>

    <section className="stats-grid compact-stats">
      <StatCard title="Total" value={group.stats?.total ?? 0}/>
      <StatCard title="OK" value={group.stats?.ok ?? 0} tone="green"/>
      <StatCard title="Redirects" value={group.stats?.redirects ?? 0} tone="yellow"/>
      <StatCard title="4xx" value={group.stats?.client_errors ?? 0} tone="orange"/>
      <StatCard title="5xx" value={group.stats?.server_errors ?? 0} tone="red"/>
      <StatCard title="Unreachable" value={group.stats?.unreachable ?? 0} tone="gray"/>
      <StatCard title="Avg response" value={`${group.stats?.avg_response_time ?? 0} ms`}/>
    </section>

    <section className="panel">
      <div className="section-title"><div><h2>Monitored group domains</h2><span>{group.domains.length} shared domain(s)</span></div></div>
      <div className="table-wrap"><table><thead><tr><th>Domain</th><th>Status</th><th>Last checked</th><th>Monitoring</th><th>Actions</th></tr></thead>
        <tbody>
          {group.domains.map((d) => {
            const rowChecking = checkingIds.has(Number(d.id));
            return <tr key={d.id}>
              <td>{editingDomainId === d.id ? (
                <input
                  value={editingDomainValue}
                  onChange={(e) => setEditingDomainValue(e.target.value)}
                  autoFocus
                  aria-label={`Edit ${d.url}`}
                />
              ) : (
                <div className="domain-cell">
                  <DomainLink url={d.url}/>
                  {(group.myEditRequests || []).some((r) => Number(r.domain_id) === Number(d.id)) && <span className="pending-chip">Edit pending approval</span>}
                </div>
              )}</td>
              <td><StatusBadge status={d.status} code={d.status_code}/></td>
              <td>{d.last_checked_at ? new Date(d.last_checked_at).toLocaleString() : "Never"}</td>
              <td>{d.enabled ? "Enabled" : "Disabled"}</td>
              <td>
                <div className="actions">
                  <button className="small" onClick={() => checkOneDomain(d.id)} disabled={checkingAll || rowChecking} aria-busy={rowChecking}>
                    {rowChecking ? "Checking…" : "Check now"}
                  </button>
                  {canEditDomains && (editingDomainId === d.id ? (
                    <button className="small" onClick={() => saveDomainEdit(d.id)} disabled={actionBusy === `save-edit-${d.id}`}>
                      {actionBusy === `save-edit-${d.id}` ? "Sending…" : "Save"}
                    </button>
                  ) : (
                    <button className="small" onClick={() => { setEditingDomainId(d.id); setEditingDomainValue(d.url); }}>Edit</button>
                  ))}
                </div>
              </td>
            </tr>;
          })}
          {!group.domains.length && <tr><td colSpan="5" className="empty-cell">No group domains yet. An owner or privileged editor can add them above.</td></tr>}
        </tbody>
      </table></div>
    </section>

    <section className="panel">
      <div className="section-title"><div><h2>Recent group checks</h2><span>Latest status history for shared domains</span></div></div>
      <div className="history-list">
        {(group.recentHistory || []).slice(0, 20).map((item) => <div className="history-row" key={item.id}>
          <div className="history-domain"><DomainLink url={item.url}/></div>
          <StatusBadge status={item.status} code={item.status_code}/>
          <div>{item.response_time_ms ?? "-"} ms</div>
          <div>{new Date(item.checked_at).toLocaleString()}</div>
        </div>)}
        {!(group.recentHistory || []).length && <p className="empty-state">No group history yet.</p>}
      </div>
    </section>

    {!groupAdmin && <section className="panel permission-card">
      <div><h2>Access to edit</h2><p>Your current group permission is <b>{memberPermission}</b>. View members cannot change domains. Request <b>Edit</b> for owner-approved changes or <b>Privileged Edit</b> for immediate changes.</p></div>
      <div className="permission-request-row">
        <select value={requestedPermission} onChange={(e) => setRequestedPermission(e.target.value)} disabled={memberPermission === "edit_privileged"}>
          <option value="edit">Edit — owner approval</option>
          <option value="edit_privileged">Privileged Edit — immediate changes</option>
        </select>
        <input value={requestMessage} onChange={(e) => setRequestMessage(e.target.value)} placeholder="Optional reason" disabled={memberPermission === "edit_privileged"}/>
        <button onClick={requestPermission} disabled={memberPermission === "edit_privileged" || actionBusy === "permission-request"} aria-busy={actionBusy === "permission-request"}>{actionBusy === "permission-request" ? "Sending…" : "Request permission"}</button>
      </div>
      {memberPermission === "view" && <p className="subtle">You can use all read-only dashboard features now and request edit access here.</p>}
    </section>}

    <section className="panel pending-work">
      <div className="section-title"><div><h2>My pending requests</h2><span>These changes are waiting for the group owner and have not changed the shared dashboard yet.</span></div></div>
      <div className="request-list">
        {(group.myPermissionRequests || []).map((r) => <div className="request-row" key={`perm-${r.id}`}><div><strong>Permission request</strong><span>{r.requested_permission === "edit_privileged" ? "Privileged Edit" : "Edit"}{r.message ? ` — ${r.message}` : ""}</span></div><span className="pending-chip">Pending approval</span></div>)}
        {(group.myEditRequests || []).map((r) => <div className="request-row" key={`edit-${r.id}`}><div><strong>Domain edit</strong><span><DomainLink url={r.old_url}/> → {r.new_url}</span></div><span className="pending-chip">Pending approval</span></div>)}
        {(group.myDomainAddRequests || []).map((r) => <div className="request-row" key={`add-${r.id}`}><div><strong>New domain</strong><span>{r.url}</span></div><span className="pending-chip">Pending approval</span></div>)}
        {!(group.myPermissionRequests || []).length && !(group.myEditRequests || []).length && !(group.myDomainAddRequests || []).length && <p className="empty-state">No pending requests.</p>}
      </div>
    </section>

    {groupAdmin && <>
      <section className="panel"><h3>Members & permissions</h3>
        <div className="member-add"><input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Registered user's email"/><select value={permission} onChange={(e) => setPermission(e.target.value)}><option value="view">View only</option><option value="edit">Edit — requires approval</option><option value="edit_privileged">Privileged edit — instant</option></select><button onClick={addMember} disabled={!email.trim() || actionBusy === "add-member"}>{actionBusy === "add-member" ? "Saving…" : "Save member"}</button></div>
        <div className="member-list"><div className="member-row"><div><strong>Group owner</strong><span>Full administrator access</span></div><span>Admin</span></div>{group.members.map((m) => { const draft = permissionDrafts[m.id] ?? m.permission; const changed = draft !== m.permission; return (
          <div className="member-row" key={m.id}>
            <div><strong>{m.name}</strong><span>{m.email}</span></div>
            <div className="actions">
              <select value={draft} onChange={(e) => perm(m.id, e.target.value)}>
                <option value="view">View</option>
                <option value="edit">Edit — approval</option>
                <option value="edit_privileged">Privileged edit</option>
              </select>
              {changed && <button className="small" onClick={() => saveMemberPermission(m.id)} disabled={actionBusy === `permission-${m.id}`}>{actionBusy === `permission-${m.id}` ? "Saving…" : "Save"}</button>}
              <button className="small danger" onClick={() => removeMember(m.id)} disabled={actionBusy === `remove-${m.id}`}>{actionBusy === `remove-${m.id}` ? "Removing…" : "Remove"}</button>
            </div>
          </div>
        ); })}</div>
      </section>

      <section className="panel"><h3>Permission requests</h3><div className="request-list">{group.permissionRequests?.length ? group.permissionRequests.map((r) => <div className="request-row" key={r.id}><div><strong>{r.requester_name}</strong><span>{r.requester_email} requested <b>{r.requested_permission}</b>{r.message ? ` — ${r.message}` : ""}</span></div><div className="actions"><button className="small" onClick={() => reviewPermission(r.id, "approved")} disabled={actionBusy === `permission-review-${r.id}`}>{actionBusy === `permission-review-${r.id}` ? "Approving…" : "Approve"}</button><button className="small danger" onClick={() => reviewPermission(r.id, "rejected")} disabled={actionBusy === `permission-review-${r.id}`}>{actionBusy === `permission-review-${r.id}` ? "Processing…" : "Reject"}</button></div></div>) : <p className="empty-state">No pending permission requests.</p>}</div></section>

      <section className="panel"><h3>Pending domain additions</h3><div className="request-list">{group.domainAddRequests?.length ? group.domainAddRequests.map((r) => <div className="request-row" key={r.id}><div><strong>{r.requester_name}</strong><span>{r.requester_email} requested <b>{r.url}</b></span></div><div className="actions"><button className="small" onClick={() => reviewDomainAdd(r.id, "approved")} disabled={actionBusy === `add-review-${r.id}`}>{actionBusy === `add-review-${r.id}` ? "Approving…" : "Approve"}</button><button className="small danger" onClick={() => reviewDomainAdd(r.id, "rejected")} disabled={actionBusy === `add-review-${r.id}`}>{actionBusy === `add-review-${r.id}` ? "Processing…" : "Reject"}</button></div></div>) : <p className="empty-state">No pending domain additions.</p>}</div></section>

      <section className="panel"><h3>Pending domain edits</h3><div className="request-list">{group.editRequests.length ? group.editRequests.map((r) => <div className="request-row" key={r.id}><div><strong><DomainLink url={r.url}/></strong><span>{r.requester_name} requested <b>{r.new_url}</b></span></div><div className="actions"><button className="small" onClick={() => reviewEdit(r.id, "approved")} disabled={actionBusy === `edit-review-${r.id}`}>{actionBusy === `edit-review-${r.id}` ? "Approving…" : "Approve"}</button><button className="small danger" onClick={() => reviewEdit(r.id, "rejected")} disabled={actionBusy === `edit-review-${r.id}`}>{actionBusy === `edit-review-${r.id}` ? "Processing…" : "Reject"}</button></div></div>) : <p className="empty-state">No pending edit requests.</p>}</div></section>
    </>}
      </div>
    );
  }

  return (
    <div>
    <div className="page-header"><div><span className="eyebrow">Shared workspaces</span><h1>Groups</h1><p>Create or join a group. Every group opens its own dashboard so members can see the same domains and status.</p></div></div>
    {message && <div className="message panel">{message}</div>}
    <div className="group-actions-grid">
      <section className="panel group-create"><h2>Create a group</h2><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Group name"/><select multiple value={selectedDomains} onChange={(e) => setSelectedDomains(Array.from(e.target.selectedOptions, (o) => Number(o.value)))}>{allDomains.filter((d) => d.permission === "admin").map((d) => <option key={d.id} value={d.id}>{d.url}</option>)}</select><button onClick={create} disabled={busy || !name.trim()}>Create Group</button></section>
      <section className="panel group-create"><h2>Join a group</h2><p className="subtle">Joining always starts with view permission. You can request elevated access from the group dashboard.</p><input value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} placeholder="DM-XXXXXXXX"/><button onClick={join} disabled={busy || !joinCode.trim()}>Join with view access</button></section>
    </div>

    <section className="panel"><div className="section-title"><h2>Your groups</h2><span>{groups.length} group(s)</span></div>{!groups.length ? <p className="empty-state">No groups yet.</p> : <div className="group-card-grid">{groups.map((item) => <button key={item.id} className="group-card" onClick={() => openGroup(item.id)} disabled={busy}><div className="group-card-head"><strong>{item.name}</strong><span>→</span></div><p>Group ID: {item.id}</p><span>{item.domain_count} domains · {item.member_count} members · {item.permission}</span></button>)}</div>}</section>

    <section className="panel"><div className="section-title"><div><h2>Saved dashboards</h2><span>Kept inside Groups; there is no separate dashboard page.</span></div></div><div className="dashboard-builder inline-builder"><input value={dashboardName} onChange={(e) => setDashboardName(e.target.value)} placeholder="Dashboard name"/><select value={dashboardGroupId} onChange={(e) => setDashboardGroupId(e.target.value)}><option value="">Personal domains</option>{groups.map((g) => <option key={g.id} value={g.id}>Group: {g.name}</option>)}</select><button onClick={makeDashboard} disabled={busy || !dashboardName.trim()}>Create dashboard</button></div>{dashboards.length ? <div className="dashboard-grid">{dashboards.map((d) => <div className="dashboard-item" key={d.id}><button onClick={() => openSavedDashboard(d.id)}><strong>{d.name}</strong><span>{d.group_name || "Personal"}</span></button><button className="icon-danger" onClick={() => removeSavedDashboard(d.id)}>×</button></div>)}</div> : <p className="empty-state">No saved dashboards yet.</p>}</section>

    {dashboard && (
      <section className="panel">
        <div className="section-title">
          <div>
            <h2>{dashboard.dashboard.name}</h2>
            <span>{dashboard.dashboard.group_name || "Personal domains"}</span>
          </div>
          <button className="small" onClick={() => setDashboard(null)}>Close</button>
        </div>
        <section className="stats-grid compact-stats">
          <StatCard title="Total" value={dashboard.stats.total}/>
          <StatCard title="OK" value={dashboard.stats.ok} tone="green"/>
          <StatCard title="Redirects" value={dashboard.stats.redirects} tone="yellow"/>
          <StatCard title="4xx" value={dashboard.stats.client_errors} tone="orange"/>
          <StatCard title="5xx" value={dashboard.stats.server_errors} tone="red"/>
          <StatCard title="Unreachable" value={dashboard.stats.unreachable} tone="gray"/>
        </section>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Domain</th><th>Status</th><th>Response</th><th>Last checked</th></tr></thead>
            <tbody>
              {dashboard.domains.map((d) => (
                <tr key={d.id}>
                  <td><DomainLink url={d.url}/></td>
                  <td><StatusBadge status={d.status} code={d.status_code}/></td>
                  <td>{d.response_time_ms ?? "-"} ms</td>
                  <td>{d.last_checked_at ? new Date(d.last_checked_at).toLocaleString() : "Never"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    )}
    </div>
  );
}
