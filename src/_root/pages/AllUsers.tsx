import { useEffect, useMemo, useState } from "react";

import Loader from "@/components/shared/Loader";
import UserCard from "@/components/shared/UserCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import useDebounce from "@/hooks/useDebounce";
import { usePeople } from "@/lib/react-query/people";

const pageSize = 12;

const AllUsers = () => {
  const [searchValue, setSearchValue] = useState("");
  const [visibleLimit, setVisibleLimit] = useState(pageSize);
  const searchTerm = searchValue.trim().normalize("NFKC").toLowerCase();
  const debouncedSearch = useDebounce(searchTerm, 350);
  const isDebouncing = searchTerm !== debouncedSearch;
  const {
    people,
    isPending,
    isError,
    isFetching,
    isPaused,
    fetchStatus,
    hasNextPage,
    fetchNextPage,
    refetch,
  } = usePeople();

  const matches = useMemo(
    () => people.filter((person) =>
      !debouncedSearch || [person.name, person.username].some((value) =>
        typeof value === "string" &&
        value.normalize("NFKC").toLowerCase().includes(debouncedSearch)
      )
    ),
    [people, debouncedSearch]
  );
  const visiblePeople = matches.slice(0, visibleLimit);
  const needsMoreMatches = matches.length < visibleLimit && !!hasNextPage;
  const isSearchingMore =
    !isDebouncing && needsMoreMatches && !isError && !isPaused;

  useEffect(() => {
    if (!isDebouncing && needsMoreMatches && fetchStatus === "idle" && !isError) {
      void fetchNextPage({ cancelRefetch: false });
    }
  }, [fetchNextPage, fetchStatus, isDebouncing, isError, needsMoreMatches]);

  return (
    <div className="common-container">
      <div className="user-container">
        <h2 className="h3-bold md:h2-bold text-left w-full">People</h2>
        <div className="flex w-full gap-3 rounded-lg bg-dark-4 px-4">
          <img src="/assets/icons/search.svg" width={24} height={24} alt="" />
          <Input
            type="search"
            aria-label="Search people by name or username"
            placeholder="Search names or usernames"
            className="explore-search"
            value={searchValue}
            onChange={(event) => {
              setSearchValue(event.target.value);
              setVisibleLimit(pageSize);
            }}
          />
        </div>

        {isDebouncing ? (
          <Loader />
        ) : (
          <>
            {visiblePeople.length > 0 && (
              <p className="w-full text-light-3 small-regular" aria-live="polite">
                Showing {visiblePeople.length} {debouncedSearch ? "matches" : "people"}
              </p>
            )}
            <ul className="user-grid">
              {visiblePeople.map((person) => (
                <li key={person.$id} className="flex-1 min-w-0 w-full">
                  <UserCard user={person} />
                </li>
              ))}
            </ul>
            {(isPending && !isPaused) || isSearchingMore ? (
              <div className="flex w-full flex-col items-center gap-3" role="status">
                <Loader />
                {debouncedSearch && (
                  <p className="text-light-3 small-regular">Searching people…</p>
                )}
              </div>
            ) : isPaused ? (
              <p className="text-light-3" role="status">
                You’re offline. Reconnect to continue loading people.
              </p>
            ) : isError ? (
              <div className="flex w-full flex-col items-center gap-3 text-center">
                <p className="text-light-3" role="status">
                  {debouncedSearch ? "Couldn’t finish searching people." : "Couldn’t load people."}
                </p>
                <Button
                  type="button"
                  className="shad-button_dark_4 self-center"
                  disabled={isFetching}
                  onClick={() => void refetch()}
                >
                  Try again
                </Button>
              </div>
            ) : visiblePeople.length === 0 ? (
              <p className="w-full text-center text-light-3" role="status">
                {debouncedSearch ? "No people match your search." : "No people yet."}
              </p>
            ) : null}

            {!isError &&
              !isPaused &&
              !isSearchingMore &&
              (matches.length > visibleLimit || hasNextPage) && (
                <Button
                  type="button"
                  className="shad-button_dark_4 self-center"
                  onClick={() => setVisibleLimit((limit) => limit + pageSize)}
                >
                  Load more
                </Button>
              )}
          </>
        )}
      </div>
    </div>
  );
};

export default AllUsers;
