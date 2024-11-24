# Cinema Schedule Management System Instructions

## Project Overview
This is a full-stack web application for managing cinema schedules across multiple locations. The system handles:
- Movie scheduling across multiple cinema locations and screens
- Film distributor management
- Cinema and screen configuration
- Schedule conflict prevention
- User access control (admin and distributor roles)

## Architecture

### Client Architecture
- React-based SPA using Vite
- React Query for server state management
- Zustand for client state management
- React Router for navigation
- Tailwind CSS for styling
- Shadcn UI for component library
- TypeScript for type safety

### Server Architecture
- Node.js with Express
- SQLite database with better-sqlite3
- JWT-based authentication
- TypeScript for type safety
- Zod for validation

## Key Business Rules

### Schedule Management
1. Each screen can only show one film at a time
2. Schedule conflicts must be prevented
3. Films must have valid release dates
4. Each film is associated with a specific distributor
5. Screen types (normal/large) affect capacity

### User Access
1. Admin users can:
   - Manage all schedules
   - Add/edit cinemas and screens
   - Manage distributors
   - Add/edit films
   - Manage users
2. Distributor users can:
   - View schedules
   - Manage their own films

### Cinema Operations
1. Each cinema has multiple screens
2. Screens have specific types and capacities
3. Screens must be properly allocated based on film requirements

## Code Organization Guidelines

### Client Code Structure
- Components should be feature-based
- Use hooks for shared logic
- Keep API calls in dedicated hooks
- Use TypeScript interfaces for all data types
- Implement proper error boundaries
- Use React Query for caching and updates

### Server Code Structure
- Routes should be feature-based
- Use middleware for authentication
- Implement proper error handling
- Use Zod schemas for validation
- Keep database queries optimized
- Maintain consistent error responses

## Development Workflow
1. Always use TypeScript
2. Follow the established project structure
3. Implement proper error handling
4. Add comments for complex business logic
5. Use provided UI components for consistency
6. Follow RESTful API patterns
7. Validate all user inputs
8. Handle loading and error states

## Security Considerations
1. Properly validate JWT tokens
2. Sanitize all database inputs
3. Implement proper CORS policies
4. Use proper role-based access control
5. Handle sensitive data appropriately
6. Validate file uploads if implemented
7. Implement rate limiting for API endpoints

## Performance Guidelines
1. Optimize database queries
2. Implement proper caching
3. Lazy load components where appropriate
4. Minimize bundle size
5. Use proper indexing in database
6. Optimize API response sizes
7. Handle large datasets efficiently

## Common Patterns
1. Use React Query for data fetching
2. Implement proper loading states
3. Handle errors consistently
4. Use the toast system for notifications
5. Follow form validation patterns
6. Use dialog components for modals
7. Implement proper data refresh strategies

## Testing Approach
1. Focus on business logic
2. Test scheduling conflict prevention
3. Verify access control
4. Test data validation
5. Ensure proper error handling
6. Verify schedule generation
7. Test screen allocation logic

## Deployment Considerations
1. Set up proper environment variables
2. Configure database backups
3. Implement logging
4. Set up monitoring
5. Configure security policies
6. Plan for database migrations
7. Document deployment procedures
