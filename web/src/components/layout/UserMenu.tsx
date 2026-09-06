import React, { useState, useRef, useEffect } from "react";

export interface UserMenuProps {
  username?: string;
  groupName?: string;
  role?: string;
  onLogout: () => void;
}

export function UserMenu({ username = "Usuário", groupName = "Turma ADS - Noite", role = "Aluno", onLogout }: UserMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Extract initials for avatar
  const initials = username
    ? username
        .split(" ")
        .map((n) => n[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "JD";

  // Close when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  return (
    <div className="user-menu-container" ref={menuRef} style={{ position: "relative" }}>
      <button
        type="button"
        className="user-menu-trigger"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-label="Menu do usuário"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          padding: "6px 12px 6px 6px",
          background: "var(--bg-card-secondary)",
          border: "1px solid var(--border-card)",
          borderRadius: "var(--radius-full)",
          cursor: "pointer",
          transition: "all var(--transition-fast)",
        }}
      >
        <div
          className="user-avatar"
          style={{
            width: "32px",
            height: "32px",
            borderRadius: "50%",
            backgroundColor: "var(--color-brand-primary)",
            color: "#ffffff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "12px",
            fontWeight: "700",
            flexShrink: 0,
          }}
        >
          {initials || "JD"}
        </div>
        <div className="user-info-text" style={{ textAlign: "left", lineHeight: "1.2" }}>
          <div style={{ fontSize: "12px", fontWeight: "700", color: "var(--text-primary)" }}>
            {groupName}
          </div>
          <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>
            {username} • {role}
          </div>
        </div>
        <i
          className="ph ph-caret-down"
          style={{
            fontSize: "14px",
            color: "var(--text-muted)",
            transform: isOpen ? "rotate(180deg)" : "none",
            transition: "transform var(--transition-fast)",
          }}
          aria-hidden="true"
        />
      </button>

      {isOpen && (
        <div
          className="user-menu-dropdown"
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            width: "240px",
            background: "var(--bg-card)",
            border: "1px solid var(--border-card)",
            borderRadius: "var(--radius-lg)",
            boxShadow: "var(--shadow-xl)",
            padding: "8px",
            zIndex: 100,
            animation: "fadeIn 0.15s ease-out",
          }}
        >
          <div
            style={{
              padding: "10px 12px",
              borderBottom: "1px solid var(--border-subtle)",
              marginBottom: "6px",
            }}
          >
            <div style={{ fontSize: "13px", fontWeight: "600", color: "var(--text-primary)" }}>
              {groupName}
            </div>
            <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "2px" }}>
              Logado como <strong style={{ color: "var(--text-primary)" }}>{username}</strong>
            </div>
          </div>

          <button
            type="button"
            className="user-menu-item"
            onClick={() => {
              setIsOpen(false);
              onLogout();
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              width: "100%",
              padding: "10px 12px",
              borderRadius: "var(--radius-md)",
              background: "transparent",
              color: "var(--color-danger-text)",
              fontSize: "13px",
              fontWeight: "600",
              textAlign: "left",
              cursor: "pointer",
              transition: "background-color var(--transition-fast)",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--color-danger-bg)")}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
          >
            <i className="ph ph-sign-out" style={{ fontSize: "16px" }} aria-hidden="true" />
            <span>Sair da conta</span>
          </button>
        </div>
      )}
    </div>
  );
}
