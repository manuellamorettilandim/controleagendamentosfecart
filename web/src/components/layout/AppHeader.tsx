import React, { useState } from "react";
import { UserMenu } from "./UserMenu";

export type NavTab = "overview" | "active-session" | "statistics" | "guides";

export interface AppHeaderProps {
  currentTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  username?: string;
  groupName?: string;
  role?: string;
  onLogout: () => void;
  notificationCount?: number;
}

export function AppHeader({
  currentTab,
  onSelectTab,
  theme,
  onToggleTheme,
  username,
  groupName,
  role,
  onLogout,
  notificationCount = 2,
}: AppHeaderProps) {
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  return (
    <header
      className="app-header"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        backgroundColor: "var(--bg-nav)",
        backdropFilter: "blur(12px)",
        borderBottom: "1px solid var(--border-subtle)",
        transition: "background-color var(--transition-normal), border-color var(--transition-normal)",
      }}
    >
      <div
        style={{
          maxWidth: "var(--container-max-width)",
          margin: "0 auto",
          padding: "12px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "16px",
        }}
      >
        {/* Brand Logo */}
        <div
          onClick={() => onSelectTab("overview")}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            cursor: "pointer",
            userSelect: "none",
          }}
        >
          <div
            style={{
              width: "36px",
              height: "36px",
              borderRadius: "10px",
              overflow: "hidden",
              flexShrink: 0,
            }}
          >
            <img
              src="/assets/fecart-logo.png"
              alt="Fecart"
              style={{ display: "block", width: "100%", height: "100%", objectFit: "contain" }}
            />
          </div>
          <div style={{ fontSize: "18px", fontWeight: "700", color: "var(--text-primary)", letterSpacing: "-0.02em" }}>
            Fecart <span style={{ color: "var(--color-brand-primary)" }}>AI Share</span>
          </div>
        </div>

        {/* Center Nav Tabs */}
        <nav
          className="header-nav-tabs"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            backgroundColor: "var(--bg-card-secondary)",
            padding: "4px",
            borderRadius: "var(--radius-full)",
            border: "1px solid var(--border-subtle)",
          }}
        >
          <button
            type="button"
            className={`nav-tab-btn ${currentTab === "overview" || currentTab === "active-session" ? "is-active" : ""}`}
            onClick={() => onSelectTab("overview")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "8px 18px",
              borderRadius: "var(--radius-full)",
              fontSize: "13px",
              fontWeight: "600",
              cursor: "pointer",
              border: "none",
              backgroundColor:
                currentTab === "overview" || currentTab === "active-session"
                  ? "var(--bg-card)"
                  : "transparent",
              color:
                currentTab === "overview" || currentTab === "active-session"
                  ? "var(--color-brand-primary)"
                  : "var(--text-secondary)",
              boxShadow:
                currentTab === "overview" || currentTab === "active-session"
                  ? "var(--shadow-sm)"
                  : "none",
              transition: "all var(--transition-fast)",
            }}
          >
            <i className="ph ph-house" style={{ fontSize: "16px" }} aria-hidden="true" />
            <span>Visão geral</span>
          </button>

          <button
            type="button"
            className={`nav-tab-btn ${currentTab === "statistics" ? "is-active" : ""}`}
            onClick={() => onSelectTab("statistics")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "8px 18px",
              borderRadius: "var(--radius-full)",
              fontSize: "13px",
              fontWeight: "600",
              cursor: "pointer",
              border: "none",
              backgroundColor: currentTab === "statistics" ? "var(--bg-card)" : "transparent",
              color: currentTab === "statistics" ? "var(--color-brand-primary)" : "var(--text-secondary)",
              boxShadow: currentTab === "statistics" ? "var(--shadow-sm)" : "none",
              transition: "all var(--transition-fast)",
            }}
          >
            <i className="ph ph-chart-bar" style={{ fontSize: "16px" }} aria-hidden="true" />
            <span>Estatísticas & Modelos</span>
          </button>

          <button
            type="button"
            className={`nav-tab-btn ${currentTab === "guides" ? "is-active" : ""}`}
            onClick={() => onSelectTab("guides")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "8px 18px",
              borderRadius: "var(--radius-full)",
              fontSize: "13px",
              fontWeight: "600",
              cursor: "pointer",
              border: "none",
              backgroundColor: currentTab === "guides" ? "var(--bg-card)" : "transparent",
              color: currentTab === "guides" ? "var(--color-brand-primary)" : "var(--text-secondary)",
              boxShadow: currentTab === "guides" ? "var(--shadow-sm)" : "none",
              transition: "all var(--transition-fast)",
            }}
          >
            <i className="ph ph-book-open" style={{ fontSize: "16px" }} aria-hidden="true" />
            <span>Guias de Acesso</span>
          </button>
        </nav>

        {/* Right Actions */}
        <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
          {/* Theme Toggle */}
          <button
            type="button"
            id="theme-toggle"
            onClick={onToggleTheme}
            aria-label={theme === "light" ? "Alternar para tema escuro" : "Alternar para tema claro"}
            title={theme === "light" ? "Alternar para tema escuro" : "Alternar para tema claro"}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--text-secondary)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "8px",
              borderRadius: "50%",
              transition: "color var(--transition-fast), background-color var(--transition-fast)",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--bg-card-hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
          >
            <i
              className={`ph ${theme === "light" ? "ph-sun" : "ph-moon"}`}
              style={{ fontSize: "20px" }}
              aria-hidden="true"
            />
          </button>

          {/* Notifications Bell */}
          <div style={{ position: "relative" }}>
            <button
              type="button"
              onClick={() => setNotificationsOpen(!notificationsOpen)}
              aria-label="Abrir notificações"
              style={{
                position: "relative",
                background: "transparent",
                border: "none",
                color: "var(--text-secondary)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "8px",
                borderRadius: "50%",
                transition: "color var(--transition-fast), background-color var(--transition-fast)",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--bg-card-hover)")}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
            >
              <i className="ph ph-bell" style={{ fontSize: "20px" }} aria-hidden="true" />
              {notificationCount > 0 && (
                <span
                  style={{
                    position: "absolute",
                    top: "3px",
                    right: "3px",
                    backgroundColor: "var(--color-danger)",
                    color: "#ffffff",
                    fontSize: "10px",
                    fontWeight: "700",
                    width: "16px",
                    height: "16px",
                    borderRadius: "50%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    border: "2px solid var(--bg-card)",
                  }}
                >
                  {notificationCount}
                </span>
              )}
            </button>

            {notificationsOpen && (
              <div
                style={{
                  position: "absolute",
                  top: "calc(100% + 8px)",
                  right: 0,
                  width: "280px",
                  background: "var(--bg-card)",
                  border: "1px solid var(--border-card)",
                  borderRadius: "var(--radius-lg)",
                  boxShadow: "var(--shadow-xl)",
                  padding: "12px",
                  zIndex: 100,
                  animation: "fadeIn 0.15s ease-out",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <strong style={{ fontSize: "13px", color: "var(--text-primary)" }}>Notificações</strong>
                  <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>{notificationCount} novas</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "12px" }}>
                  <div style={{ padding: "8px", background: "var(--bg-card-secondary)", borderRadius: "var(--radius-sm)" }}>
                    <div style={{ fontWeight: "600", color: "var(--text-primary)" }}>Reserva aprovada</div>
                    <div style={{ color: "var(--text-muted)" }}>Sua sessão para hoje às 14:00 foi confirmada.</div>
                  </div>
                  <div style={{ padding: "8px", background: "var(--bg-card-secondary)", borderRadius: "var(--radius-sm)" }}>
                    <div style={{ fontWeight: "600", color: "var(--text-primary)" }}>Novos horários liberados</div>
                    <div style={{ color: "var(--text-muted)" }}>A agenda da próxima semana está aberta para reservas.</div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* User Menu */}
          <UserMenu username={username} groupName={groupName} role={role} onLogout={onLogout} />
        </div>
      </div>
    </header>
  );
}
