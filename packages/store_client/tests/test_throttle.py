from store_client import ThrottleStatus


def test_wait_is_points_needed_divided_by_restore_rate():
    status = ThrottleStatus(maximum_available=1000, currently_available=4, restore_rate=50)
    assert status.wait_seconds(cost=10) == (10 - 4) / 50


def test_no_wait_when_bucket_has_enough_points():
    status = ThrottleStatus(maximum_available=1000, currently_available=500, restore_rate=50)
    assert status.wait_seconds(cost=10) == 0
