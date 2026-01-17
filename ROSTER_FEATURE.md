# Roster Feature Documentation

## Overview
Comprehensive roster management system for pilot scheduling, currency tracking, discrepancy detection, and FDP compliance monitoring.

## Features Implemented

### Phase 1: Core Infrastructure
- **Database Schema**: Added scheduleEntries, currencies, and discrepancies tables
- **Types**: Complete TypeScript types for roster entities
- **Schedule Parser**: Smart CSV parsing with UTC/Local Base time conversion
- **Personnel Bi-hydrating**: Automatic crew name healing (20-char truncation fix)
- **Smart Flight Matching**: Normalizes flight numbers and matches existing flights

### Phase 2: Enhanced Roster UI
- **Roster Page**: Schedule display with list and calendar views
- **DutyEntryCard**: Color-coded duty type cards with sector details
- **RosterCalendar**: Monthly calendar view with duty indicators
- **Navigation**: Added Roster to bottom navigation bar

### Phase 3: Draft Flight Generation
- **Auto-generation**: Creates draft flights from schedule entries
- **Trigger Modes**: day_before, day_of, report_time, manual
- **Background Processing**: Runs every 5 minutes
- **Settings UI**: Configurable auto-populate options

### Phase 4: Currency Tracking UI
- **CurrencyCard**: Visual status indicators (valid/warning/critical/expired)
- **Currencies Page**: Full CRUD operations with filtering
- **Dashboard Integration**: Shows expiring currencies
- **Auto-update**: Can update from schedule CSV imports

### Phase 5: Discrepancy Detection UI
- **DiscrepancyCard**: Severity-based display (error/warning/info)
- **Discrepancies Page**: Type and status filtering
- **Resolution Dialog**: 4 resolution methods (keep logbook/schedule, merge, ignore)
- **Dashboard Integration**: Shows unresolved discrepancies

### Phase 6: FDP Dashboard
- **FDP Calculator**: CAAS-compliant calculations
- **Rolling Limits**: 7/14/28/90/365-day tracking
- **Compliance Status**: OK/Warning/Critical/Exceeded indicators
- **Dashboard Integration**: Shows non-compliant periods

### Phase 7: Final Integration
- **Navigation**: Sub-page links highlighted in bottom navbar
- **Quick Access**: Direct links from roster page to currencies/discrepancies/FDP
- **Unified Experience**: Seamless navigation between all roster features

## Pages

### /roster
Main roster page with schedule import, list/calendar views, and draft generation

### /currencies
Currency and expiry management with filtering and CRUD operations

### /discrepancies
Discrepancy detection and resolution with type-based filtering

### /fdp
FDP dashboard with regulatory compliance tracking and rolling limits

## Data Flow

1. **Import**: User uploads schedule CSV via /roster
2. **Parse**: Schedule parser processes CSV, creates entries, detects discrepancies
3. **Link**: Smart matching links schedule to existing flights
4. **Generate**: Draft generator creates draft flights from unlinked entries
5. **Track**: Currency updates from schedule, FDP calculations run automatically
6. **Monitor**: Dashboard displays warnings for currencies, discrepancies, FDP limits

## Navigation Structure

```
Home (Dashboard)
  ├─ Currency Warnings → /currencies
  ├─ Discrepancy Warnings → /discrepancies
  └─ FDP Warnings → /fdp

Roster (Bottom Nav)
  ├─ /roster (Main)
  │   ├─ Quick Access: Currencies
  │   ├─ Quick Access: Discrepancies
  │   └─ Quick Access: FDP
  ├─ /currencies
  ├─ /discrepancies
  └─ /fdp
```

## Key Components

- **DutyEntryCard**: Display schedule entries
- **RosterCalendar**: Monthly calendar view
- **CurrencyCard**: Currency status display
- **CurrencyFormDialog**: Add/edit currencies
- **DiscrepancyCard**: Discrepancy display
- **DiscrepancyResolutionDialog**: Resolve discrepancies
- **DutyPeriodCard**: FDP compliance display
- **DraftSettings**: Draft generation configuration

## Utilities

- **schedule-parser.ts**: CSV parsing with smart matching
- **draft-generator.ts**: Automatic draft flight creation
- **fdp-calculator.ts**: FDP calculations and compliance checking

## Regulatory Compliance (CAAS)

- **7 Days**: 60h duty, 30h flight
- **14 Days**: 110h duty, 60h flight
- **28 Days**: 190h duty, 100h flight
- **90 Days**: 280h flight
- **365 Days**: 900h flight
- **Single Duty**: Max 13h (varies by report time)

## Future Enhancements

- Rest period calculations
- Fatigue risk management
- Multi-currency support
- Export to PDF/Excel
- Sync with airline scheduling systems
- Mobile notifications for expiring currencies
