## Objective

- Complete priority-aware scheduling support in FastDeploy.
- The requested changes cover Request.priority transport.
- The requested changes cover Request.priority defaults.
- The requested changes cover LocalScheduler queue ordering.
- The requested changes cover DPLocalScheduler queue ordering.
- The requested changes cover ResourceManagerV1 continuous batching.
- The requested changes cover ResourceManagerV1 admission.
- The requested changes cover EngineClient valid-parameter checks.
- The requested changes cover the EngineArgs --scheduling-policy flag.

## Important Details

- The requested scheduling policies are fcfs and priority.
- The requested default policy is fcfs.
- Existing fcfs behavior must remain unchanged.
- LocalSchedulerConfig.check() raises ValueError for an unsupported scheduling policy.
- DPLocalSchedulerConfig.check() raises ValueError for an unsupported scheduling policy.
- SchedulerConfig.check() raises ValueError for an unsupported scheduling policy.
- max_num_seqs accounting must remain unchanged.
- A waiting request blocked only by max_num_seqs must not preempt a running request.
- The visible Request constructor uses priority: Optional[int] = None.
- The visible Request constructor stores priority as 0 when the argument is None.
- The repository-wide 100644-to-100755 mode changes predate this work.
- Do not change file permissions.
- Do not change git config.
- rg is unavailable in the environment.
- Use grep for searches.
- The priority check in valid_parameters runs before the max_tokens check.
- Smaller priority values are scheduled first.
- Equal-priority requests retain arrival order.
- LocalScheduler priority insertion occurs before the first larger priority.
- LocalScheduler priority insertion stays at or after ids_read_cursor.
- ResourceManagerV1 orders waiting requests by ascending (priority, arrival_time).
- The priority victim selector may use the requester as a last-resort victim after considering strictly lower-precedence RUNNING_DECODE requests.
- A minimal {"request_id", "priority"} dictionary can exercise the priority validation error before other EngineClient attributes are accessed.
- An `EngineClient.__new__(EngineClient)` instance can be used for the fcfs fallback test.
- The priority-path test sets fd_config.scheduler_config.scheduling_policy to "priority".
- New ResourceManagerV1 tests must avoid create_engine_config.
- New ResourceManagerV1 tests must allocate instances with `ResourceManagerV1.__new__(ResourceManagerV1)`.
- The tests must bypass `ResourceManagerV1.__init__`.
- Set only the ResourceManagerV1 attributes required by each test.
- Stub `apply_async_preprocess` for test paths that call it.
- The `__new__` fixture avoids IPCSignal initialization.
- The `__new__` fixture avoids ThreadPoolExecutor initialization.
- The `__new__` fixture avoids metrics initialization.
- The `__new__` fixture avoids cache-manager initialization.
- For Mock(spec=Request), set request.metrics.arrival_time to a concrete value.
- An unset Mock metrics arrival_time cannot be ordered.

## Work State

- The implementation edits are present in the current worktree.
- MockLocalScheduler in test_dp_scheduler.py accepts scheduling_policy.
- The recorded DPLocalScheduler test run passed after that mock fix.
- Two scheduling-policy tests were added to TestDPLocalScheduler.
- Two scheduling-policy tests were added to TestDPScheduler.
- The dp_scheduler suite passed with 27 tests after those additions.
- TestLocalSchedulerPriority was added to test_local_scheduler.py.
- The local-scheduler suite passed after that addition.
- Scheduling-policy tests were added to test_scheduler_config.py.
- The scheduler-config suite passed after those additions.
- A combined baseline run of test_local_scheduler.py, test_scheduler_config.py, and test_request.py passed.
- The combined baseline run reported 128 passing tests.
- The local-scheduler suite had 21 pre-existing tests.
- Twelve priority tests were added to the local-scheduler suite.
- The later local-scheduler run passed.
- The scheduler-config suite had 21 pre-existing tests.
- Twelve scheduling-policy tests were added to the scheduler-config suite.
- The later scheduler-config run passed.
- Request priority tests remained in progress at the g18 point.
- The latest recorded test_request.py read used offset 55.
- That read output was truncated at line 95.
- The recorded test_engine_client.py read shows lines 331-365.
- That test_engine_client.py read output is truncated.
- The EngineClient test file is /app/tests/entrypoints/test_engine_client.py.
- test_resource_manager_v1.py has 111 lines.
- test_resource_manager_v1.py was read in full.
- Local execution of the existing TestResourceManagerV1 setup failed while calling create_engine_config.
- One recorded validation test run failed on an empty-model path.
- ParameterError subclasses Exception.

## Next Move

- Add Request priority tests in /app/tests/engine/test_request.py.
- Test that the Request priority default is 0.
- Test that None is normalized to 0.
- Test that negative priorities are preserved.
- Test that to_dict includes priority.
- Test that from_dict restores priority.
- Test that from_generic_request restores priority.
- Test the pickle round trip.
- Avoid collisions with existing test method names.
- Complete EngineClient validation tests in /app/tests/entrypoints/test_engine_client.py.
- Import ParameterError from fastdeploy.utils for EngineClient validation tests.
- Test that the default-policy setup raises ParameterError for priority 5.
- Test that priority 0 passes validation.
- Set the scheduling policy to priority for priority-path tests.
- Test that the priority path accepts priority 5.
- Test that the priority path accepts priority -3.
- Use an `EngineClient.__new__(EngineClient)` instance for the fcfs fallback test.
- Complete ResourceManagerV1 coverage without calling create_engine_config.
- Allocate test managers with `ResourceManagerV1.__new__(ResourceManagerV1)`.
- Do not call `ResourceManagerV1.__init__` in the test fixture.
- Set only the attributes required by each test.
- Stub `apply_async_preprocess` in test paths that call it.
- Set request.metrics.arrival_time explicitly for Mock(spec=Request) objects used in precedence-ordering tests.
- Test policy-flip reordering in get_waiting_request_ids().
- Test that switching back to fcfs restores arrival order.
- Test precedence re-entry in reschedule_preempt_task.
- Add unit coverage for _waiting_precedence_key.
- Add unit coverage for _ordered_waiting_requests.
- Test that reclaim returns False under fcfs.
- Test that reclaim returns True when needed_blocks is less than or equal to 0.
- Add coverage for fcfs scheduling.
- Add coverage for priority scheduling.
- Run the new and existing suites with `cd /app && python -m pytest tests/scheduler tests/engine tests/entrypoints -q`.
- Fix failures reported by the scheduler test suite.
- Fix failures reported by the engine test suite.
- Fix failures reported by the entrypoints test suite.
- Keep the default fcfs behavior covered by tests.

## Relevant Files

- /app/tests/scheduler/test_local_scheduler.py
- /app/tests/scheduler/test_scheduler_config.py
- /app/tests/scheduler/test_dp_scheduler.py
- /app/tests/engine/test_request.py
- /app/tests/engine/test_resource_manager_v1.py
- /app/tests/entrypoints/test_engine_client.py
- /app/fastdeploy/scheduler/dp_scheduler.py
- /app/fastdeploy/utils.py
