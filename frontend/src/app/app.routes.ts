import { Routes } from '@angular/router';
import { authGuard, teacherGuard } from './core/auth';
import { Login } from './pages/login/login';

export const routes: Routes = [
  { path: 'login', component: Login, title: 'Sign in · Shalom Academy' },
  { path: '', canActivate: [authGuard], loadComponent: () => import('./pages/new-receipt/new-receipt').then(m => m.NewReceipt), title: 'New receipt · Shalom Academy' },
  { path: 'today', canActivate: [authGuard], loadComponent: () => import('./pages/today/today').then(m => m.Today), title: "Today's special · Shalom Academy" },
  { path: 'payments', canActivate: [authGuard], loadComponent: () => import('./pages/payments/payments').then(m => m.Payments), title: 'Payments · Shalom Academy' },
  { path: 'students', canActivate: [authGuard], loadComponent: () => import('./pages/students/students').then(m => m.Students), title: 'Students · Shalom Academy' },
  { path: 'register/:token', loadComponent: () => import('./pages/register/register').then(m => m.Register), title: 'Registration · Shalom Academy' },
  { path: 'registrations', canActivate: [authGuard], loadComponent: () => import('./pages/registrations/registrations').then(m => m.Registrations), title: 'Registration pool · Shalom Academy' },
  { path: 'classes', canActivate: [authGuard], loadComponent: () => import('./pages/classes/classes').then(m => m.Classes), title: 'Classes · Shalom Academy' },
  { path: 'attendance', canActivate: [authGuard], loadComponent: () => import('./pages/roll/roll').then(m => m.Roll), title: 'Attendance · Shalom Academy' },
  { path: 'roll', canActivate: [teacherGuard], loadComponent: () => import('./pages/roll/roll').then(m => m.Roll), title: 'Students · Shalom Academy' },
  { path: 'teachers', canActivate: [authGuard], loadComponent: () => import('./pages/teachers/teachers').then(m => m.Teachers), title: 'Teachers · Shalom Academy' },
  { path: 'checkin', canActivate: [teacherGuard], loadComponent: () => import('./pages/checkin/checkin').then(m => m.CheckIn), title: 'Check in · Shalom Academy' },
  { path: 'world', canActivate: [authGuard], loadComponent: () => import('./pages/world/world').then(m => m.World), title: 'World clock · Shalom Academy' },
  { path: 'history', canActivate: [authGuard], loadComponent: () => import('./pages/history/history').then(m => m.History), title: 'History · Shalom Academy' },
  { path: 'settings', canActivate: [authGuard], loadComponent: () => import('./pages/settings/settings').then(m => m.Settings), title: 'Settings · Shalom Academy' },
  { path: '**', redirectTo: '' },
];
