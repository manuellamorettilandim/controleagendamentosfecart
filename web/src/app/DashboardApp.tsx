import React, { useState, useEffect, useRef } from "react";
import { AppHeader, NavTab } from "../components/layout/AppHeader";
import { OverviewHero } from "../components/overview/OverviewHero";
import { NextSessionCard, ReservationInfo } from "../components/overview/NextSessionCard";
import { ActiveSessionWidget } from "../components/overview/ActiveSessionWidget";
import { ScheduleGrid, DayScheduleData } from "../components/schedule/ScheduleGrid";
import { DaySlotData } from "../components/schedule/ScheduleDay";
import { BookingModal } from "../components/schedule/BookingModal";
import { ReservationActionModal } from "../components/schedule/ReservationActionModal";
import { ActiveSessionView } from "../components/active-session/ActiveSessionView";
import { StatisticsView } from "../components/statistics/StatisticsView";
import { GuidesView } from "../components/guides/GuidesView";
import { useDashboardData } from "../features/dashboard/useDashboardData";

export function DashboardApp() {
  const [currentTab, setCurrentTab] = useState<NavTab>("overview");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [isScheduleHighlighted, setIsScheduleHighlighted] = useState(false);

  // Booking & Action Modals State
  const [isBookingOpen, setIsBookingOpen] = useState(false);
  const [bookingDate, setBookingDate] = useState<Date | null>(null);
  const [bookingSlot, setBookingSlot] = useState<DaySlotData | null>(null);
  const [bookingSlotTime, setBookingSlotTime] = useState<string | undefined>();
  const [selectedActionReservation, setSelectedActionReservation] = useState<ReservationInfo | null>(null);

  const {
    profile,
    accounts,
    selectedAccountId,
    setSelectedAccountId,
    weekLabel,
    days,
    reservations,
    busySlots,
    prevWeek,
    nextWeek,
    activeReservation,
    nextReservation,
    activeSessionToken,
    activeSessionMetrics,
    activeSessionTimings,
    userStatistics,
    isLoading,
    error,
    isRefreshing,
    refreshData,
    createReservation,
    cancelReservation,
    logout,
  } = useDashboardData();

  // Initialize theme from storage
  useEffect(() => {
    try {
      const savedTheme = localStorage.getItem("fecart-theme");
      if (savedTheme === "dark" || savedTheme === "light") {
        setTheme(savedTheme);
        document.documentElement.dataset.theme = savedTheme;
      } else {
        document.documentElement.dataset.theme = "light";
      }
    } catch {
      document.documentElement.dataset.theme = "light";
    }
  }, []);

  // Listen to hash changes for deep linking
  useEffect(() => {
    function handleHash() {
      const hash = window.location.hash.replace("#", "");
      if (hash === "session" || hash === "active-session") setCurrentTab("active-session");
      else if (hash === "statistics") setCurrentTab("statistics");
      else if (hash === "guides") setCurrentTab("guides");
      else setCurrentTab("overview");
    }

    handleHash();
    window.addEventListener("hashchange", handleHash);
    return () => window.removeEventListener("hashchange", handleHash);
  }, []);

  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("fecart-theme", next);
    } catch {
      // Storage unavailable
    }
  }

  function handleTabSelect(tab: NavTab) {
    setCurrentTab(tab);
    if (tab === "overview") window.location.hash = "overview";
    else if (tab === "active-session") window.location.hash = "active-session";
    else if (tab === "statistics") window.location.hash = "statistics";
    else if (tab === "guides") window.location.hash = "guides";
  }

  // Smooth scroll & highlight CTA handler
  function handleReserveNowCTA() {
    if (currentTab !== "overview") {
      setCurrentTab("overview");
    }

    // Allow view to render if we switched tabs
    setTimeout(() => {
      const scheduleEl = document.getElementById("schedule-section");
      if (scheduleEl) {
        const rect = scheduleEl.getBoundingClientRect();
        const isInViewport = rect.top >= 80 && rect.bottom <= (window.innerHeight || document.documentElement.clientHeight);

        if (!isInViewport) {
          scheduleEl.scrollIntoView({ behavior: "smooth", block: "center" });
        }

        // Apply temporary soft highlight for 1.5s
        setIsScheduleHighlighted(true);
        setTimeout(() => {
          setIsScheduleHighlighted(false);
        }, 1500);
      }
    }, 50);
  }

  function handleSelectSlot(day: DayScheduleData, slot: DaySlotData) {
    if (slot.status === "available") {
      setBookingDate(day.date);
      setBookingSlot(slot);
      setBookingSlotTime(slot.timeLabel);
      setIsBookingOpen(true);
    } else if (slot.status === "mine" && slot.reservationId) {
      const found = nextReservation?.id === slot.reservationId ? nextReservation : activeReservation;
      if (found) {
        setSelectedActionReservation(found);
      }
    }
  }

  return (
    <div className="fecart-app" style={{ minHeight: "100vh", position: "relative" }}>
      {/* Ambient background decoration */}
      <div className="bg-ambient-layer" aria-hidden="true">
        <div className="bg-ambient-wave" />
      </div>

      {/* Main Header */}
      <AppHeader
        currentTab={currentTab}
        onSelectTab={handleTabSelect}
        theme={theme}
        onToggleTheme={toggleTheme}
        username={profile.username}
        groupName={profile.groupName}
        role={profile.role}
        onLogout={logout}
      />

      {/* Page Content */}
      <main className="app-container">
        {/* TAB 1: Overview & Scheduling */}
        {currentTab === "overview" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
            {/* Top Grid: Hero (Left) & Session Info (Right) */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 340px",
                gap: "24px",
                alignItems: "stretch",
              }}
              className="overview-top-grid"
            >
              <OverviewHero theme={theme} onReserveClick={handleReserveNowCTA} />

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "16px",
                  height: "100%",
                }}
                className="overview-top-grid-aside"
              >
                <NextSessionCard
                  session={nextReservation}
                  onViewDetails={() => handleTabSelect("active-session")}
                  onScheduleClick={handleReserveNowCTA}
                />

                <ActiveSessionWidget
                  isActive={activeReservation !== null}
                  remainingTimeFormatted={activeSessionTimings.remainingTimeFormatted}
                  onOpenActiveSession={() => handleTabSelect("active-session")}
                />
              </div>
            </div>

            {/* Weekly Schedule */}
            <ScheduleGrid
              accounts={accounts}
              selectedAccountId={selectedAccountId}
              onSelectAccount={setSelectedAccountId}
              weekLabel={weekLabel}
              onPrevWeek={prevWeek}
              onNextWeek={nextWeek}
              days={days}
              onSelectSlot={handleSelectSlot}
              onRefresh={refreshData}
              isRefreshing={isRefreshing}
              isHighlighted={isScheduleHighlighted}
            />
          </div>
        )}

        {/* TAB 2: Active Session */}
        {currentTab === "active-session" && (
          <ActiveSessionView
            onBackToOverview={() => handleTabSelect("overview")}
            onOpenGuides={() => handleTabSelect("guides")}
            isActiveSession={activeReservation !== null}
            isLoading={isLoading}
            errorMessage={error}
            token={activeSessionToken}
            reservationId={activeReservation?.id}
            accountLabel={activeReservation?.accountLabel}
            startTimeFormatted={activeSessionTimings.startTimeFormatted}
            endTimeFormatted={activeSessionTimings.endTimeFormatted}
            durationLabel={activeSessionTimings.durationLabel}
            remainingTimeFormatted={activeSessionTimings.remainingTimeFormatted}
            timePercentage={activeSessionTimings.timePercentage}
            quotaRemainingPercent={activeSessionTimings.quotaRemainingPercent}
            modelsCount={activeSessionMetrics.modelsCount}
            totalTokensFormatted={activeSessionMetrics.totalTokens.toLocaleString("pt-BR")}
            commandsCount={activeSessionMetrics.commandsCount}
            statusLabel={activeSessionMetrics.statusLabel}
            modelsUsed={activeSessionMetrics.modelsUsed}
            onRefresh={refreshData}
            isRefreshing={isRefreshing}
          />
        )}

        {/* TAB 3: Statistics & Models */}
        {currentTab === "statistics" && (
          <StatisticsView
            dateRangeLabel={weekLabel}
            sessionsCount={userStatistics.sessionsCount}
            sessionsDeltaText={userStatistics.sessionsDeltaText}
            hoursCount={userStatistics.hoursCount}
            hoursDeltaText={userStatistics.hoursDeltaText}
            tokensCount={userStatistics.tokensCount}
            tokensDeltaText={userStatistics.tokensDeltaText}
            occupancyRate={userStatistics.occupancyRate}
            occupancyDeltaText={userStatistics.occupancyDeltaText}
            lineChartData={userStatistics.lineChartData}
            barChartItems={userStatistics.barChartItems}
            heatmapMatrix={userStatistics.heatmapMatrix}
            observedModels={userStatistics.observedModels}
          />
        )}

        {/* TAB 4: Access Guides */}
        {currentTab === "guides" && <GuidesView theme={theme} />}
      </main>

      {/* Booking Dialog Modal */}
      <BookingModal
        isOpen={isBookingOpen}
        onClose={() => {
          setIsBookingOpen(false);
          setBookingSlot(null);
        }}
        accounts={accounts}
        selectedAccountId={selectedAccountId}
        initialDate={bookingDate}
        initialSlot={bookingSlot}
        initialSlotTime={bookingSlotTime}
        onConfirmBooking={createReservation}
        reservations={reservations}
        busySlots={busySlots}
      />

      {/* Reservation Action / Cancel Modal */}
      <ReservationActionModal
        isOpen={selectedActionReservation !== null}
        onClose={() => setSelectedActionReservation(null)}
        reservation={selectedActionReservation}
        onCancelReservation={cancelReservation}
      />
    </div>
  );
}
