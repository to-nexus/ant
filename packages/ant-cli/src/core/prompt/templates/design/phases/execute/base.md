You are creating a SYSTEM DESIGN DOCUMENT for: **{{project}}**

This is a detailed technical specification that will be used by the code generation phase.

{{#if currentTask}}
🎯 CURRENT TASK:
**Task Name**: {{currentTask.name}}
**Description**: {{currentTask.description}}
{{/if}}

{{#if designDoc}}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## EXISTING DESIGN DOCUMENT (from previous tasks):

{{designDoc}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**IMPORTANT**: The above is the work from previous tasks. For this task:
1. Focus ONLY on the section(s) relevant to your current task
2. Update or expand those specific sections
3. Return the COMPLETE updated document (with your changes integrated)
4. Keep all other sections unchanged

This incremental approach ensures efficient token usage while maintaining document completeness.

{{/if}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## YOUR DESIGN STRATEGY:

{{plan}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## INSTRUCTIONS:

{{#unless designDoc}}
This is the initial task. Create a comprehensive system design document that includes:
{{else}}
Update the existing document above by focusing on your current task. Modify/expand only the relevant sections, then return the complete document.
{{/unless}}

### 1. Overview
- System purpose and goals
- Key stakeholders
- High-level architecture diagram (in text/ASCII or description)
- Core use cases

### 2. Architecture
- **System Architecture**: Overall system structure and component layout
- **Component Architecture**: Major components and their responsibilities
- **Data Architecture**: Data models, storage strategy, and data flow
- **Integration Architecture**: External systems, APIs, and communication patterns

### 3. Detailed Design

#### 3.1 Component Design
For each major component identified in your strategy:
- Purpose and responsibility
- Internal structure and organization
- Key algorithms or business logic
- Dependencies and interfaces
- Error handling approach

#### 3.2 Data Models
- Entity definitions with attributes
- Relationships and cardinality
- Schemas (database tables, collections, API contracts)
- Data validation rules
- Indexing and query optimization considerations

#### 3.3 API Design
- Endpoints and operations (REST, GraphQL, gRPC, etc.)
- Request/response formats with examples
- Authentication and authorization mechanisms
- Rate limiting and throttling
- Error responses and status codes
- Versioning strategy

#### 3.4 User Interface Design (if applicable)
- Screen flows and navigation
- Key interactions and user journeys
- State management approach
- Responsive design considerations
- Accessibility requirements

### 4. Technical Decisions

#### 4.1 Technology Stack
- Languages and frameworks (with versions)
- Databases and storage solutions
- Third-party services and libraries
- Infrastructure and deployment platform
- Justification for each major choice

#### 4.2 Design Patterns
- Architectural patterns (MVC, MVVM, microservices, event-driven, etc.)
- Code patterns and best practices
- Rationale for pattern selection

### 5. Non-Functional Requirements

#### 5.1 Performance
- Response time targets and SLAs
- Throughput requirements (requests/sec, transactions/sec)
- Scalability approach (horizontal vs. vertical)
- Caching strategy (where, what, TTL)
- Database query optimization

#### 5.2 Security
- Authentication and authorization approach
- Data encryption (at rest and in transit)
- API security (API keys, OAuth, JWT)
- Input validation and sanitization
- Security best practices and compliance

#### 5.3 Reliability & Availability
- Uptime targets (SLA)
- Fault tolerance and redundancy
- Backup and disaster recovery
- Monitoring and alerting strategy

### 6. Implementation Considerations

#### 6.1 Development Workflow
- Repository structure and organization
- Branching strategy (Git flow, trunk-based, etc.)
- Code review process
- Testing strategy (unit, integration, E2E)

#### 6.2 Deployment Strategy
- CI/CD pipeline
- Environment management (dev, staging, prod)
- Containerization approach (if applicable)
- Infrastructure as Code (if applicable)
- Rollback strategy

### 7. Future Considerations
- Known limitations and technical debt
- Scalability roadmap
- Feature extensibility points
- Migration paths (if evolving from existing system)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**IMPORTANT**: This document will be used by the code generation phase. 
Make it detailed, specific, and actionable. Include concrete examples where helpful.

Focus on the areas highlighted in your design strategy as most critical.
- Data encryption
- Security best practices
- Compliance considerations

#### 5.3 Reliability
- Availability targets
- Fault tolerance
- Disaster recovery
- Monitoring and logging

#### 5.4 Maintainability
- Code organization
- Testing strategy
- Documentation approach
- Deployment process

### 6. Implementation Roadmap
- Phase 1: Core functionality
- Phase 2: Additional features
- Phase 3: Optimization and polish
- Estimated effort and timeline

### 7. Risks and Mitigation
- Technical risks
- Business risks
- Mitigation strategies

### 8. Open Questions
- Items needing clarification
- Decisions deferred
- Areas for future consideration

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Generate a comprehensive design document following this structure.

Write in clear, professional markdown. Be specific and detailed, but remain readable.
