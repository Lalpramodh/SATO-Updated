# 🎓 SATO — Smart Academic Timetable Optimizer

> An intelligent, constraint-based academic timetable generation and management platform powered by Google OR-Tools, Flask, React, and Supabase.

SATO (Smart Academic Timetable Optimizer) is a full-stack academic scheduling platform designed to automatically generate conflict-free university timetables while considering faculty availability, room capacity, room type, student groups, course requirements, session duration, and scheduling constraints.

The system combines **Google OR-Tools CP-SAT optimization** with a modern **React dashboard** and **Supabase-powered data layer** to provide an end-to-end timetable management solution.

---

## 🚀 Live Application

🌐 **Production:**  
`https://your-vercel-domain.vercel.app`

> Replace the URL above with your deployed Vercel URL.

---

## ✨ Key Features

### 🧠 Intelligent Timetable Generation
- Constraint-based timetable generation using Google OR-Tools CP-SAT.
- Automatically assigns:
  - Courses
  - Faculty
  - Student groups
  - Rooms
  - Time slots
- Supports both 1-hour and 2-hour sessions.
- Handles theory, laboratory, project, and seminar courses.

### ⚡ Conflict-Free Scheduling

The optimizer validates and prevents:

- Faculty scheduling conflicts
- Student group conflicts
- Room conflicts
- Faculty availability violations
- Room capacity violations
- Room-type mismatches
- Invalid session durations
- Incorrect session counts
- Invalid database references

### 📊 Analytics Dashboard

The dashboard provides real-time timetable insights including:

- Optimization score
- Total sessions
- Total conflicts
- Rooms utilized
- Faculty utilized
- Student groups scheduled
- Sessions by day
- Course-type distribution
- Room utilization

### 📅 Interactive Timetable

Features include:

- Weekly timetable grid
- Monday–Friday scheduling
- Semester filtering
- Department filtering
- Course filtering
- Faculty filtering
- Room filtering
- Student group filtering
- Session detail view
- Responsive layout
- 2-hour session visualization
- CSV export

### 👨‍🏫 Faculty Management

- View faculty records
- Add new faculty
- Department-based faculty organization
- Maximum weekly teaching hours
- Faculty availability management
- Persistent Supabase storage

### 🏫 Room Management

Supports:

- Classrooms
- Laboratories
- Seminar/project rooms

Room assignments consider:

- Capacity
- Room type
- Student group size
- Course requirements

### 👥 Student Group Management

- Department-wise groups
- Semester-wise groups
- Section management
- Student count tracking

### 📚 Course Management

Supports:

- Course code
- Course name
- Department
- Semester
- Course type
- Required sessions
- Duration
- Faculty assignment

### 🔐 Authentication

Integrated with Supabase Authentication.

Includes:

- User registration
- Login
- Logout
- Session persistence
- Forgot password
- Password reset
- Protected application routes
- User profiles
- Role-ready authentication architecture

---

# 🏗️ System Architecture

```text
                    ┌─────────────────────┐
                    │      User           │
                    │   Web Browser       │
                    └──────────┬──────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │   React Frontend    │
                    │   Vite + Tailwind   │
                    └──────────┬──────────┘
                               │
                         REST API / Auth
                               │
                               ▼
                    ┌─────────────────────┐
                    │    Flask Backend    │
                    │   Python REST API   │
                    └──────────┬──────────┘
                               │
              ┌────────────────┴────────────────┐
              │                                 │
              ▼                                 ▼
    ┌─────────────────────┐          ┌─────────────────────┐
    │   OR-Tools CP-SAT   │          │      Supabase       │
    │  Optimization Engine│          │ PostgreSQL + Auth   │
    └─────────────────────┘          └─────────────────────┘
              │                                 │
              └────────────────┬────────────────┘
                               ▼
                    ┌─────────────────────┐
                    │ Generated Timetable │
                    │   + Analytics       │
                    └─────────────────────┘
